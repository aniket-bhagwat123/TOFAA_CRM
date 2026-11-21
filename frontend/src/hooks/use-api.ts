"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { readApiCache, writeApiCache } from "@/lib/api-cache";
import { apiClient, loadErrorMessage } from "@/services/api-client";

type Params = Record<string, string | number | boolean | undefined | null>;

/**
 * GET a path and keep the result. A revisit shows the last result at once and refreshes behind it, so
 * screens never start from a spinner twice. `reload()` refetches; a null path waits.
 */
export function useApi<T>(path: string | null, params?: Params) {
  const key = path ? `${path}?${JSON.stringify(params ?? {})}` : null;
  const cached = readApiCache<T>(key);
  const [data, setData] = useState<T | null>(cached);
  const [loading, setLoading] = useState(!!path && cached === null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(0);

  // Switching to a different key (a new filter, say) shows that key's cached copy straight away.
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    const next = readApiCache<T>(key);
    if (next !== null && next !== data) setData(next);
  }

  const load = useCallback(async () => {
    if (!path || !key) return;
    const id = ++latest.current;
    if (readApiCache(key) === null) setLoading(true);
    try {
      const clean = Object.fromEntries(Object.entries(params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== ""));
      const res = await apiClient.get<T>(path, { params: clean });
      if (id === latest.current) {
        writeApiCache(key, res.data);
        setData(res.data);
        setError(null);
      }
    } catch (e) {
      if (id === latest.current) setError(loadErrorMessage(e));
    } finally {
      if (id === latest.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, reload: load, setData };
}
