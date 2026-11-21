/** Date helpers that never touch time zones: a date is just year / month / day. */
export type Ymd = { y: number; m: number; d: number }; // m: 1-12

export const parseYmd = (iso?: string | null): Ymd | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
};
export const toIso = ({ y, m, d }: Ymd) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
export const daysInMonth = (y: number, m: number) => new Date(y, m, 0).getDate();
/** 0 = Monday ... 6 = Sunday, for the first day of the month. */
export const mondayIndex = (y: number, m: number) => (new Date(y, m - 1, 1).getDay() + 6) % 7;
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const longDate = (iso?: string | null) => {
  const p = parseYmd(iso);
  return p ? `${p.d} ${MONTHS[p.m - 1].slice(0, 3)} ${p.y}` : "";
};

/** "14:30" -> { h12: 2, min: 30, pm: true } and back. */
export const parseTime = (v?: string | null) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(v ?? "");
  if (!m) return null;
  const h = +m[1];
  return { h12: h % 12 === 0 ? 12 : h % 12, min: +m[2], pm: h >= 12 };
};
export const buildTime = (h12: number, min: number, pm: boolean) =>
  `${String((h12 % 12) + (pm ? 12 : 0)).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
export const longTime = (v?: string | null) => {
  const t = parseTime(v);
  return t ? `${t.h12}:${String(t.min).padStart(2, "0")} ${t.pm ? "PM" : "AM"}` : "";
};
