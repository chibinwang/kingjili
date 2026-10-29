/**
 * The demo runs on a pinned clock so every walkthrough is identical.
 * All timestamps are ISO strings in Asia/Taipei (+08:00); dates are "YYYY-MM-DD".
 */
export const DEMO_TODAY = "2026-10-24";
export const DEMO_NOW = "2026-10-24T07:05:00+08:00";
export const TZ = "Asia/Taipei";

/** A monotonic demo clock: each call advances by a few seconds from the pinned start. */
let tick = 0;
export function demoNow(): string {
  tick += 1;
  const base = Date.parse(DEMO_NOW) + tick * 17_000;
  return toTaipeiIso(base);
}
export function resetDemoClock(to = 0) {
  tick = to;
}

export function toTaipeiIso(epochMs: number): string {
  const d = new Date(epochMs + 8 * 3600_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+08:00`;
}

export function at(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00+08:00`;
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400_000);
}

export function periodOf(dateOrIso: string): string {
  return dateOrIso.slice(0, 7);
}

export function periodRange(period: string): { start: string; end: string } {
  const [y, m] = period.split("-").map(Number);
  const start = `${period}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end: addDays(next, -1) };
}

export function datePart(iso: string): string {
  return iso.slice(0, 10);
}

export function timePart(iso: string): string {
  return iso.slice(11, 16);
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function hhmm(minutes: number): string {
  const m = Math.round(minutes);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

export function formatDate(date: string, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const [y, m, d] = date.slice(0, 10).split("-");
  const base = opts.year ? `${y}/${m}/${d}` : `${Number(m)}/${Number(d)}`;
  return opts.weekday ? `${base}（${WEEKDAY[dayOfWeek(date.slice(0, 10))]}）` : base;
}

export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${timePart(iso)}`;
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split("-");
  return `${y} 年 ${Number(m)} 月`;
}
