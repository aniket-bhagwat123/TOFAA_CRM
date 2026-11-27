"use client";
import { useEffect, useState, type ReactNode } from "react";
import { PAGE_SIZE, Pagination } from "./pagination";

/**
 * Pages a list that is already loaded in full: show `rows`, then `footer` under them. `resetKey` (the filters and
 * search) goes back to page 1 when it changes. The footer shows whenever there is something to list.
 */
export function usePaged<T>(items: T[], noun: [singular: string, plural: string], resetKey = ""): { rows: T[]; footer: ReactNode } {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(PAGE_SIZE);
  useEffect(() => setPage(1), [resetKey]);
  const current = Math.min(page, Math.max(1, Math.ceil(items.length / size))); // a delete can empty the last page
  const footer = items.length > 0
    ? <Pagination page={current} pageSize={size} total={items.length} noun={noun} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} />
    : null;
  return { rows: items.slice((current - 1) * size, current * size), footer };
}
