import { createHmac } from "crypto";

/**
 * Invio email di prospezione tramite l'API transazionale di Brevo e lettura
 * degli esiti (consegna, aperture, clic, rimbalzi, spam, disiscrizioni).
 */
const API = "https://api.brevo.com/v3";
export const TAG_PROSPEZIONE = "prospezione";
export const MITTENTE_EMAIL = "info@recensionia5stelle.it";
export const RISPOSTA_EMAIL = "assistenza@recensionia5stelle.it";
const DASHBOARD_URL = process.env.NEXT_PUBLIC_DASHBOARD_URL || "https://dashboard.recensionia5stelle.it";

function chiave(): string {
  const k = process.env.BREVO_API_KEY;
  if (!k) throw new Error("BREVO_API_KEY mancante: aggiungila nelle variabili d'ambiente su Vercel.");
  return k;
}

export function brevoConfigurato(): boolean {
  return !!process.env.BREVO_API_KEY;
}

async function brevo<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "api-key": chiave(), "content-type": "application/json", accept: "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = data?.message || data?.code || `Errore Brevo ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/* ---------- Disiscrizione: link firmato, non falsificabile ---------- */

function firma(email: string): string {
  const secret = process.env.SESSION_SECRET || "";
  return createHmac("sha256", secret).update(`disiscrizione:${email.toLowerCase()}`).digest("hex").slice(0, 32);
}

export function linkDisiscrizione(email: string): string {
  const e = Buffer.from(email.toLowerCase()).toString("base64url");
  return `${DASHBOARD_URL}/api/disiscrizione?e=${e}&t=${firma(email)}`;
}

export function verificaDisiscrizione(e: string, t: string): string | null {
  try {
    const email = Buffer.from(e, "base64url").toString("utf8").toLowerCase();
    if (!email.includes("@")) return null;
    return firma(email) === t ? email : null;
  } catch {
    return null;
  }
}

/* ---------- Invio ---------- */

export async function inviaEmail(opts: {
  to: string;
  toName?: string;
  oggetto: string;
  html: string;
  testo: string;
  nomeMittente: string;
  tag?: string;
}): Promise<string> {
  const unsub = linkDisiscrizione(opts.to);
  const data = await brevo<{ messageId: string }>("/smtp/email", {
    method: "POST",
    body: JSON.stringify({
      sender: { name: opts.nomeMittente, email: MITTENTE_EMAIL },
      replyTo: { name: "Assistenza Recensioni a 5 Stelle", email: RISPOSTA_EMAIL },
      to: [{ email: opts.to, name: opts.toName || undefined }],
      subject: opts.oggetto,
      htmlContent: opts.html,
      textContent: opts.testo,
      tags: [opts.tag || TAG_PROSPEZIONE],
      headers: {
        "List-Unsubscribe": `<${unsub}>, <mailto:${RISPOSTA_EMAIL}?subject=disiscrizione>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }),
  });
  return data.messageId;
}

/* ---------- Esiti ---------- */

export type EventoBrevo = {
  email: string;
  date: string;
  messageId: string;
  event: string; // delivered, opened, clicks, hardBounces, softBounces, spam, unsubscribed, blocked, invalid, error, deferred, requests, loadedByProxy
  reason?: string;
  link?: string;
};

/** Eventi degli ultimi `giorni` giorni per le email di prospezione. */
export async function eventiProspezione(giorni = 90): Promise<EventoBrevo[]> {
  const out: EventoBrevo[] = [];
  const limit = 2500;
  for (let offset = 0; offset < 50000; offset += limit) {
    const q = new URLSearchParams({ limit: String(limit), offset: String(offset), days: String(giorni), tags: TAG_PROSPEZIONE, sort: "asc" });
    const data = await brevo<{ events?: EventoBrevo[] }>(`/smtp/statistics/events?${q}`);
    const ev = data.events || [];
    out.push(...ev);
    if (ev.length < limit) break;
  }
  return out;
}

/** Aggiunge l'indirizzo alla blocklist di Brevo (nessun altro invio possibile). */
export async function bloccaSuBrevo(email: string): Promise<void> {
  try {
    await brevo("/contacts", {
      method: "POST",
      body: JSON.stringify({ email, emailBlacklisted: true, updateEnabled: true }),
    });
  } catch {
    // non bloccante: la nostra lista contatti ha già il flag "Bloccato"
  }
}
