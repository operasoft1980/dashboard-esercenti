/**
 * Il foglio contiene date in più formati (scritte da Make, da Tally o dalla
 * dashboard): "2026-09-27", "2026-09-27 21:38", ISO completo, oppure
 * "28/09/2026 00:47". Queste funzioni le normalizzano.
 */
export function parseSheetDate(value: string | null | undefined): Date | null {
  const s = (value || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) {
    return new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    return new Date(+m[3], +m[2] - 1, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" del giorno di una data del foglio (per i filtri Da/A). */
export function sheetDay(value: string | null | undefined): string {
  const d = parseSheetDate(value);
  if (!d) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function formatDataIt(value: string | Date | null | undefined, withTime = false): string {
  const d = value instanceof Date ? value : parseSheetDate(value || "");
  if (!d) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
}

/** Giorni interi da oggi alla data (negativo = già passata). */
export function giorniDaOggi(value: string | Date | null | undefined): number | null {
  const d = value instanceof Date ? value : parseSheetDate(value || "");
  if (!d) return null;
  const oggi = new Date();
  oggi.setHours(0, 0, 0, 0);
  const g = new Date(d);
  g.setHours(0, 0, 0, 0);
  return Math.round((g.getTime() - oggi.getTime()) / 86400000);
}
