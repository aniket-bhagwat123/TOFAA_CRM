import axios from "axios";

/** Field-level errors from a 422 response: { fieldName: message }. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!axios.isAxiosError(err)) return {};
  const list = (err.response?.data as { data?: { errors?: { field: string; message: string }[] } })?.data?.errors ?? [];
  return Object.fromEntries(list.map((e) => [e.field, e.message]));
}

export function errorData<T = unknown>(err: unknown): T | undefined {
  return axios.isAxiosError(err) ? ((err.response?.data as { data?: T })?.data ?? undefined) : undefined;
}

export const statusOf = (err: unknown) => (axios.isAxiosError(err) ? err.response?.status : undefined);
