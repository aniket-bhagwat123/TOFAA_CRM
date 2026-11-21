const full = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const paise = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,23,456 (or with paise). */
export const inr = (n?: number | null, withPaise = false) => (n == null ? "—" : `₹${(withPaise ? paise : full).format(n)}`);

/** ₹4.5L, ₹1.2Cr, ₹850: short, for cards. */
export function inrShort(n?: number | null): string {
  if (n == null) return "—";
  const trim = (v: number) => String(Number(v.toFixed(v >= 100 ? 0 : 1)));
  if (n >= 1e7) return `₹${trim(n / 1e7)}Cr`;
  if (n >= 1e5) return `₹${trim(n / 1e5)}L`;
  return `₹${full.format(n)}`;
}

/** The same sums the server does, to show totals while typing. The server recomputes and is the one that counts. */
export function quoteTotals(items: { quantity: string; unitPrice: string }[], discountPct: string) {
  const subtotal = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const pct = Math.min(Math.max(Number(discountPct) || 0, 0), 100);
  const discount = Math.round(subtotal * pct) / 100;
  return { subtotal, discount, total: Math.round((subtotal - discount) * 100) / 100 };
}
