/**
 * Last result of every GET, kept in memory. Screens show it instantly on a revisit while the fresh copy
 * loads (stale-while-revalidate). Cleared on sign-out so one person's data never shows for the next.
 */
const store = new Map<string, unknown>();

export const readApiCache = <T,>(key: string | null): T | null => (key && store.has(key) ? (store.get(key) as T) : null);
export const writeApiCache = (key: string, value: unknown) => {
  if (store.size > 200) store.delete(store.keys().next().value as string);
  store.set(key, value);
};
export const clearApiCache = () => store.clear();
