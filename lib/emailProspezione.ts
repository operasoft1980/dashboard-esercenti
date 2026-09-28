/**
 * Composizione dell'email ai potenziali clienti (usata sia dal server per
 * l'invio sia dal browser per l'anteprima: nessuna dipendenza da Node).
 *
 * Segnaposti: {{nome}} {{citta}} {{tipo}} {{voto}} {{recensioni}}
 * Regola: se in un paragrafo c'è un segnaposto senza valore (es. attività
 * senza voto su Google), l'intero paragrafo viene tolto, così il testo non
 * contiene mai frasi a metà.
 */
export const SITO_URL = "https://recensionia5stelle.it/?utm_source=email&utm_medium=prospezione&utm_campaign=presentazione";
export const WHATSAPP = "+39 351 519 6518";

export type DatiContatto = {
  nome: string;
  citta: string;
  tipo: string;
  voto: number | null;
  recensioni: number | null;
};

function valori(c: DatiContatto): Record<string, string> {
  return {
    nome: (c.nome || "").trim(),
    citta: (c.citta || "").trim(),
    tipo: (c.tipo || "").trim().toLowerCase(),
    voto: c.voto != null && c.voto > 0 ? c.voto.toFixed(1).replace(".", ",") : "",
    recensioni: c.recensioni != null && c.recensioni > 0 ? String(Math.round(c.recensioni)) : "",
  };
}

const RE = /\{\{\s*(nome|citta|tipo|voto|recensioni)\s*\}\}/g;

export function personalizzaOggetto(oggetto: string, c: DatiContatto): string {
  const v = valori(c);
  return oggetto.replace(RE, (_, k: string) => v[k] || "").replace(/\s{2,}/g, " ").replace(/^[\s:,-]+/, "").trim();
}

/** Paragrafi del corpo già personalizzati (quelli con dati mancanti sono tolti). */
export function paragrafi(corpo: string, c: DatiContatto): string[] {
  const v = valori(c);
  return corpo
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => {
      const usati = Array.from(p.matchAll(RE)).map((m) => m[1]);
      return usati.every((k) => v[k]);
    })
    .map((p) => p.replace(RE, (_, k: string) => v[k]));
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function componiHtml(corpo: string, c: DatiContatto, linkDisiscrizione: string): string {
  const ps = paragrafi(corpo, c)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2933">${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recensioni a 5 Stelle</title></head>
<body style="margin:0;padding:0;background:#f6f4ef;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:14px;border:1px solid #e4e0d6">
<tr><td style="padding:28px 32px 8px;text-align:center">
<div style="font-family:Georgia,serif;font-size:24px;font-weight:bold;color:#111b21">Recensioni a 5 Stelle</div>
<div style="font-size:22px;color:#d9a441;letter-spacing:4px;margin-top:4px">★★★★★</div>
</td></tr>
<tr><td style="padding:20px 32px 8px">
${ps}
</td></tr>
<tr><td align="center" style="padding:4px 32px 28px">
<a href="${SITO_URL}" style="display:inline-block;background:#1fae58;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;padding:14px 28px;border-radius:10px">Scopri come funziona</a>
<div style="font-size:13px;color:#5b6670;margin-top:10px">Prova gratuita di 30 giorni · disdici quando vuoi</div>
</td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td style="padding:16px 32px;font-size:12px;line-height:1.5;color:#5b6670;text-align:center">
Vi scriviamo perché questo indirizzo è pubblicato sulla scheda Google Maps della vostra attività.<br>
Recensioni a 5 Stelle è un servizio di Almobea Servizi · P.IVA IT03893990923 · WhatsApp ${WHATSAPP}<br>
Non volete ricevere altre email? <a href="${linkDisiscrizione}" style="color:#5b6670">Disiscrivetevi con un clic</a>.
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export function componiTesto(corpo: string, c: DatiContatto, linkDisiscrizione: string): string {
  return [
    ...paragrafi(corpo, c),
    `Scopri come funziona: ${SITO_URL}`,
    "—",
    "Vi scriviamo perché questo indirizzo è pubblicato sulla scheda Google Maps della vostra attività.",
    "Recensioni a 5 Stelle è un servizio di Almobea Servizi · P.IVA IT03893990923",
    `Per non ricevere altre email: ${linkDisiscrizione}`,
  ].join("\n\n");
}
