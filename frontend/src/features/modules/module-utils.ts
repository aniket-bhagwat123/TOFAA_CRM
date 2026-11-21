import type { ApiRecord } from "@/types/api";

export const labelFor = (key: string) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

export function formatCell(record: ApiRecord, column: string): string {
  const v = record[column];
  if (v == null || v === "") return "-";
  if (typeof v === "number" && /budget|amount|price/i.test(column)) return v.toLocaleString("en-IN", { style: "currency", currency: "INR" });
  return String(v);
}
