const BRT = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

/** Data (YYYY-MM-DD) em America/Sao_Paulo. */
export function toBrDate(date: Date): string {
  return BRT.format(date);
}

/** Soma meses a um mês "YYYY-MM". */
export function addMonths(month: string, delta: number): string {
  const [year = 0, monthIndex = 1] = month.split("-").map(Number);
  const total = year * 12 + (monthIndex - 1) + delta;
  const y = Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
}

/** Último dia do mês "YYYY-MM" como data ISO. */
export function monthEnd(month: string): string {
  const [year = 0, monthIndex = 1] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

/** Meses inclusivos de `from` a `to`, ambos "YYYY-MM". */
export function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let current = from;
  while (current <= to) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}

/** Dias de calendário de `b − a` (positivo se `b` é depois de `a`); UTC, sem fuso/DST. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-\d{2}$/;

/** "YYYY-MM" válido. */
export function isMonth(value: unknown): value is string {
  return typeof value === "string" && MONTH_RE.test(value);
}

/** "YYYY-MM-DD" válido no calendário (rejeita 2026-09-31 e 2026-02-29). */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [year = 0, month = 1, day = 0] = value.split("-").map(Number);
  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}
