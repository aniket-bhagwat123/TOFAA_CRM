/** Drop empty strings so optional fields are sent as absent, not "". */
export function cleanPayload<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "" && v !== undefined)) as Partial<T>;
}
