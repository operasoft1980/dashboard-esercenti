/**
 * Date "di calendario" sempre nel fuso di Roma, indipendentemente dal fuso
 * del server (Vercel gira in UTC): un incasso delle 00:30 del 1° ottobre va
 * nel bilancio di ottobre, non di settembre.
 */
const TZ = "Europe/Rome";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function parts(ms: number) {
  const p: Record<string, number> = {};
  for (const x of fmt.formatToParts(new Date(ms))) {
    if (x.type !== "literal") p[x.type] = parseInt(x.value, 10);
  }
  return p as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Scarto in minuti tra Roma e UTC in un dato istante (+60 o +120). */
function offsetMinutes(ms: number): number {
  const p = parts(ms);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/** Epoch (secondi) della mezzanotte di Roma del giorno "YYYY-MM-DD". */
export function romeDayStart(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  let ms = guess - offsetMinutes(guess) * 60000;
  ms = guess - offsetMinutes(ms) * 60000; // ricalcolo vicino ai cambi d'ora
  return Math.floor(ms / 1000);
}

/** Epoch (secondi) dell'ultimo secondo del giorno "YYYY-MM-DD" a Roma. */
export function romeDayEnd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map((n) => parseInt(n, 10));
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  const nextYmd = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
  return romeDayStart(nextYmd) - 1;
}

export function romeYmd(epochSec: number): string {
  const p = parts(epochSec * 1000);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function romeMonthKey(epochSec: number): string {
  return romeYmd(epochSec).slice(0, 7);
}

export function oggiRomaYmd(): string {
  return romeYmd(Math.floor(Date.now() / 1000));
}

/** "YYYY-MM-DD HH:mm" nel fuso di Roma. */
export function romeDateTime(epochSec: number = Math.floor(Date.now() / 1000)): string {
  const p = parts(epochSec * 1000);
  const z = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${z(p.month)}-${z(p.day)} ${z(p.hour)}:${z(p.minute)}`;
}
