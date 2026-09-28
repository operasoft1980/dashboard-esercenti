import { createHash } from "crypto";
import { sheetsClient, ESERCENTI_SPREADSHEET_ID } from "@/lib/sheets";

/**
 * Potenziali clienti (prospezione) salvati nella scheda "Contatti" del foglio
 * Database Centrale, e impostazioni della campagna nella scheda "Campagna".
 */
const CONTATTI = "Contatti";
const CAMPAGNA = "Campagna";

export const CONTATTI_HEADER = [
  "ID", "Email", "Nome attività", "Tipo", "Città", "Telefono", "Sito", "Voto",
  "N. recensioni", "Link Google Maps", "Fonte", "Importato il", "Stato", "Inviato il",
  "Message ID", "Ultimo evento", "Data ultimo evento", "Aperture", "Clic", "Bloccato",
  "Note", "Validazione email",
];

export type StatoContatto =
  | "Nuovo"
  | "Inviato"
  | "Consegnata"
  | "Aperta"
  | "Cliccata"
  | "Rimbalzata"
  | "Spam"
  | "Disiscritto"
  | "Errore";

export type Contatto = {
  riga: number;
  id: string;
  email: string;
  nome: string;
  tipo: string;
  citta: string;
  telefono: string;
  sito: string;
  voto: number | null;
  recensioni: number | null;
  linkMaps: string;
  fonte: string;
  importato: string;
  stato: StatoContatto;
  inviato: string;
  messageId: string;
  ultimoEvento: string;
  dataUltimoEvento: string;
  aperture: number;
  clic: number;
  bloccato: boolean;
  note: string;
  validazione: string;
};

export type NuovoContatto = Omit<
  Contatto,
  "riga" | "stato" | "inviato" | "messageId" | "ultimoEvento" | "dataUltimoEvento" | "aperture" | "clic" | "bloccato" | "note"
>;

export type Campagna = {
  oggetto: string;
  corpo: string;
  nomeMittente: string;
  limiteGiornaliero: number;
};

let setupInCorso: Promise<void> | null = null;

/** Crea schede e intestazioni mancanti una sola volta (anche con chiamate parallele). */
function ensureSetup(): Promise<void> {
  if (!setupInCorso) {
    setupInCorso = eseguiSetup().catch((err) => {
      setupInCorso = null;
      throw err;
    });
  }
  return setupInCorso;
}

async function eseguiSetup() {
  const sheets = sheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    fields: "sheets.properties(title)",
  });
  const titoli = new Set((meta.data.sheets || []).map((s) => s.properties?.title));
  const mancanti = [CONTATTI, CAMPAGNA].filter((t) => !titoli.has(t));
  if (mancanti.length) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: ESERCENTI_SPREADSHEET_ID,
        requestBody: { requests: mancanti.map((title) => ({ addSheet: { properties: { title } } })) },
      });
    } catch (err) {
      // creata nel frattempo da un'altra richiesta: va bene così
      if (!/already exists|esiste già/i.test(String(err))) throw err;
      return;
    }
    const data: { range: string; values: string[][] }[] = [];
    if (mancanti.includes(CONTATTI)) data.push({ range: `${CONTATTI}!A1:V1`, values: [CONTATTI_HEADER] });
    if (mancanti.includes(CAMPAGNA)) data.push({ range: `${CAMPAGNA}!A1:B1`, values: [["Chiave", "Valore"]] });
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ESERCENTI_SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data },
    });
  }
}

const num = (v: unknown): number | null => {
  const s = (v ?? "").toString().replace(",", ".").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const STATI: StatoContatto[] = ["Nuovo", "Inviato", "Consegnata", "Aperta", "Cliccata", "Rimbalzata", "Spam", "Disiscritto", "Errore"];

function rigaToContatto(r: unknown[], i: number): Contatto {
  const c = (k: number) => (r[k] ?? "").toString();
  const stato = c(12) as StatoContatto;
  return {
    riga: i + 2,
    id: c(0),
    email: c(1).trim().toLowerCase(),
    nome: c(2),
    tipo: c(3),
    citta: c(4),
    telefono: c(5),
    sito: c(6),
    voto: num(r[7]),
    recensioni: num(r[8]),
    linkMaps: c(9),
    fonte: c(10),
    importato: c(11),
    stato: STATI.includes(stato) ? stato : "Nuovo",
    inviato: c(13),
    messageId: c(14),
    ultimoEvento: c(15),
    dataUltimoEvento: c(16),
    aperture: num(r[17]) || 0,
    clic: num(r[18]) || 0,
    bloccato: c(19) === "Sì",
    note: c(20),
    validazione: c(21),
  };
}

export async function getContatti(): Promise<Contatto[]> {
  await ensureSetup();
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${CONTATTI}!A2:V20000`,
  });
  return (res.data.values || []).map(rigaToContatto).filter((c) => c.email);
}

export function idContatto(placeId: string, email: string): string {
  if (placeId) return placeId;
  return "e_" + createHash("sha1").update(email.toLowerCase()).digest("hex").slice(0, 16);
}

export async function aggiungiContatti(nuovi: NuovoContatto[]): Promise<void> {
  if (!nuovi.length) return;
  await ensureSetup();
  const values = nuovi.map((n) => [
    n.id, n.email, n.nome, n.tipo, n.citta, n.telefono, n.sito,
    n.voto == null ? "" : String(n.voto),
    n.recensioni == null ? "" : String(n.recensioni),
    n.linkMaps, n.fonte, n.importato, "Nuovo", "", "", "", "", "0", "0", "No", "", n.validazione,
  ]);
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${CONTATTI}!A1:V1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

/** Aggiornamento di colonne specifiche (M..U) su più righe in un'unica chiamata. */
export type Aggiornamento = {
  riga: number;
  stato?: StatoContatto;
  inviato?: string;
  messageId?: string;
  ultimoEvento?: string;
  dataUltimoEvento?: string;
  aperture?: number;
  clic?: number;
  bloccato?: boolean;
  note?: string;
};

const COL: Record<Exclude<keyof Aggiornamento, "riga">, string> = {
  stato: "M",
  inviato: "N",
  messageId: "O",
  ultimoEvento: "P",
  dataUltimoEvento: "Q",
  aperture: "R",
  clic: "S",
  bloccato: "T",
  note: "U",
};

export async function aggiornaContatti(agg: Aggiornamento[]): Promise<void> {
  const data: { range: string; values: string[][] }[] = [];
  for (const a of agg) {
    for (const [k, col] of Object.entries(COL) as [keyof typeof COL, string][]) {
      const v = a[k];
      if (v === undefined) continue;
      const s = typeof v === "boolean" ? (v ? "Sì" : "No") : String(v);
      data.push({ range: `${CONTATTI}!${col}${a.riga}`, values: [[s]] });
    }
  }
  for (let i = 0; i < data.length; i += 500) {
    await sheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: ESERCENTI_SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data: data.slice(i, i + 500) },
    });
  }
}

export const CAMPAGNA_DEFAULT: Campagna = {
  nomeMittente: "Recensioni a 5 Stelle",
  limiteGiornaliero: 80,
  oggetto: "{{nome}}: più recensioni Google, senza doverle chiedere",
  corpo: [
    "Buongiorno,",
    "vi scrivo perché ho visto la scheda Google di {{nome}} a {{citta}}: oggi avete {{voto}} stelle con {{recensioni}} recensioni.",
    "Molti clienti soddisfatti non lasciano una recensione solo perché nessuno glielo chiede al momento giusto. Con Recensioni a 5 Stelle, dopo ogni servizio il cliente riceve un messaggio WhatsApp con il link diretto alla vostra scheda Google: gli basta un tocco.",
    "Voi inserite il nome e il numero del cliente, al resto pensa il sistema. Nella vostra area riservata vedete in tempo reale chi ha ricevuto il messaggio e chi ha lasciato la recensione.",
    "I primi 30 giorni sono gratuiti e potete disdire quando volete, senza vincoli.",
    "Vi va di vedere come funziona? Rispondete a questa email oppure scriveteci su WhatsApp al +39 351 519 6518: ve lo mostriamo in 5 minuti.",
    "Se invece non vi interessa, nessun problema: non riceverete altri messaggi da noi.",
    "Un saluto,\nil team di Recensioni a 5 Stelle",
  ].join("\n\n"),
};

export async function getCampagna(): Promise<Campagna> {
  await ensureSetup();
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${CAMPAGNA}!A2:B20`,
  });
  const m = new Map((res.data.values || []).map((r) => [(r[0] || "").toString(), (r[1] ?? "").toString()]));
  const lim = parseInt(m.get("Limite giornaliero") || "", 10);
  return {
    oggetto: m.get("Oggetto") || CAMPAGNA_DEFAULT.oggetto,
    corpo: m.get("Corpo") || CAMPAGNA_DEFAULT.corpo,
    nomeMittente: m.get("Nome mittente") || CAMPAGNA_DEFAULT.nomeMittente,
    limiteGiornaliero: Number.isFinite(lim) && lim > 0 ? lim : CAMPAGNA_DEFAULT.limiteGiornaliero,
  };
}

export async function saveCampagna(c: Campagna): Promise<void> {
  await ensureSetup();
  await sheetsClient().spreadsheets.values.update({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${CAMPAGNA}!A2:B5`,
    valueInputOption: "RAW",
    requestBody: {
      values: [
        ["Oggetto", c.oggetto],
        ["Corpo", c.corpo],
        ["Nome mittente", c.nomeMittente],
        ["Limite giornaliero", String(c.limiteGiornaliero)],
      ],
    },
  });
}
