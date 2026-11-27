"use client";
import { useEffect, useMemo, useState } from "react";
import { apiClient, loadErrorMessage } from "@/services/api-client";
import { useApi } from "./use-api";

type Params = Record<string, string | number | boolean | undefined | null>;
type PageOf = { items: { id: string }[]; meta: { total: number; pages: number } };
const LIMIT = 100; // the most one request may ask for

/**
 * A whole list from a paged endpoint, for screens that show everything at once (the board / table modules): the first
 * 100 rows show straight away, and the rest are added as they arrive.
 */
export function useAllPages<T extends PageOf>(path: string | null, params?: Params) {
  const query: Params = { ...params, page: 1, limit: LIMIT };
  const first = useApi<T>(path, query);
  const key = `${path}?${JSON.stringify(query)}`;
  const [rest, setRest] = useState<{ key: string; items: T["items"] }>({ key: "", items: [] });
  const [restError, setRestError] = useState<string | null>(null);

  useEffect(() => {
    const pages = first.data?.meta.pages ?? 1;
    setRestError(null);
    if (!path || pages <= 1) return setRest({ key, items: [] });
    let stale = false;
    const clean = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ""));
    Promise.all(Array.from({ length: pages - 1 }, (_, i) => apiClient.get<T>(path, { params: { ...clean, page: i + 2 } })))
      .then((all) => { if (!stale) setRest({ key, items: all.flatMap((r) => r.data.items) }); })
      .catch((e) => { if (!stale) setRestError(loadErrorMessage(e)); });
    return () => { stale = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [first.data]);

  const data = useMemo(() => {
    const d = first.data;
    if (!d || rest.key !== key || d.meta.pages <= 1) return d;
    const seen = new Set(d.items.map((x) => x.id)); // a row can move between pages while they load
    return { ...d, items: [...d.items, ...rest.items.filter((x) => !seen.has(x.id))] } as T;
  }, [first.data, rest, key]);

  return { data, loading: first.loading, error: first.error ?? restError, reload: first.reload };
}
