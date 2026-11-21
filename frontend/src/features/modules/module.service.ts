import { apiClient } from "@/services/api-client";
import type { ApiRecord, Page } from "@/types/api";

type Params = { page?: number; limit?: number; search?: string; sort?: string };

// Short-lived read cache, cleared after any mutation.
const cache = new Map<string, { at: number; value: Page<ApiRecord> }>();
const TTL_MS = 15_000;

export async function getModuleRecords(endpoint: string, params: Params = {}): Promise<Page<ApiRecord>> {
  const key = endpoint + JSON.stringify(params);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = (await apiClient.get(endpoint, { params })).data as Page<ApiRecord>;
  cache.set(key, { at: Date.now(), value });
  return value;
}

export async function mutateModule<T = unknown>(
  method: "post" | "patch" | "put" | "delete",
  url: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const res = await apiClient.request({ method, url, data: body, headers });
  cache.clear();
  return res.data as T;
}

export async function getRecord(url: string): Promise<ApiRecord> {
  return (await apiClient.get(url)).data as ApiRecord;
}
