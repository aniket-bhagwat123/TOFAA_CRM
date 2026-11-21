import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { loadSession, saveSession } from "@/lib/session";
import { ENDPOINTS } from "./endpoints";

const origin = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export const apiClient = axios.create({ baseURL: `${origin}/api/v1`, timeout: 15000 });

type Retryable = InternalAxiosRequestConfig & { _retried?: boolean; _timeoutRetried?: boolean };

apiClient.interceptors.request.use((config) => {
  const token = typeof window !== "undefined" ? loadSession()?.tokens.accessToken : null;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Unwrap { data, message } so callers receive the payload directly.
apiClient.interceptors.response.use((res) => {
  if (res.data && typeof res.data === "object" && "data" in res.data) res.data = res.data.data;
  return res;
}, onError);

let refreshing: Promise<string | null> | null = null;

async function refreshToken(): Promise<string | null> {
  const session = loadSession();
  if (!session) return null;
  try {
    const res = await axios.post(`${origin}/api/v1${ENDPOINTS.auth.refresh}`, {
      refreshToken: session.tokens.refreshToken,
    });
    const tokens = res.data.data;
    saveSession({ ...session, tokens });
    return tokens.accessToken as string;
  } catch {
    return null;
  }
}

async function onError(error: AxiosError) {
  const config = error.config as Retryable | undefined;
  if (!config) throw error;

  if (error.code === "ECONNABORTED" && !config._timeoutRetried && config.method?.toLowerCase() === "get") {
    config._timeoutRetried = true;
    return apiClient(config);
  }

  const isAuthCall = config.url?.startsWith("/auth/");
  if (error.response?.status === 401 && !config._retried && !isAuthCall) {
    config._retried = true;
    refreshing ??= refreshToken().finally(() => (refreshing = null));
    const token = await refreshing;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
      return apiClient(config);
    }
    saveSession(null);
    if (typeof window !== "undefined") window.location.href = "/login";
  }
  throw error;
}

export function errorMessage(err: unknown, fallback = "Something went wrong."): string {
  if (axios.isAxiosError(err)) return (err.response?.data as { message?: string })?.message ?? fallback;
  return fallback;
}

/** A sentence a person can act on, for a failed load. */
export function loadErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    if (!err.response) return err.code === "ECONNABORTED" ? "The server took too long to answer. Please try again." : "Can't reach the server. Check your connection and try again.";
    const { status, data } = err.response;
    const server = (data as { message?: string } | undefined)?.message;
    if (status === 403) return server ?? "You don't have access to this.";
    if (status === 404) return server ?? "We couldn't find what you're looking for.";
    if (status >= 500) return "Something went wrong on our side. Please try again in a moment.";
    return server ?? "We couldn't load this.";
  }
  return "We couldn't load this.";
}
