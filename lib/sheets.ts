import { google } from "googleapis";
import { randomUUID } from "crypto";

// ---- Configuration (all via environment variables, never hardcoded) ----
const ESERCENTI_SPREADSHEET_ID = process.env.ESERCENTI_SPREADSHEET_ID!;
const ESERCENTI_SHEET_NAME = process.env.ESERCENTI_SHEET_NAME || "Untitled";
const CLIENTI_SPREADSHEET_ID = process.env.CLIENTI_SPREADSHEET_ID!;
const CLIENTI_SHEET_NAME = process.env.CLIENTI_SHEET_NAME || "Foglio1";

const ESERCENTI_COLS = {
  id: 0,
  dataAttivazione: 1,
  nomeAttivita: 2,
  email: 3,
  whatsapp: 4,
  tipoAttivita: 5,
  linkGoogleMaps: 6,
  stato: 7,
  codiceAccesso: 15,
};

const CLIENTI_COLS = {
  submissionId: 0,
  respondentId: 1,
  submittedAt: 2,
  nomeCliente: 3,
  whatsappCliente: 4,
  emailEsercente: 5,
  origine: 8,
  stato: 9,
  dataOraInvio: 10,
};

function resolvePrivateKey(): string | undefined {
  const b64 = process.env.GOOGLE_PRIVATE_KEY_BASE64;
  if (b64) {
    return Buffer.from(b64, "base64").toString("utf8");
  }
  const raw = process.env.GOOGLE_PRIVATE_KEY;
  if (raw) {
    return raw.replace(/\\n/g, "\n");
  }
  return undefined;
}

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = resolvePrivateKey();
  if (!email || !key) {
    throw new Error(
      "Credenziali Google mancanti: imposta GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY_BASE64 (oppure GOOGLE_PRIVATE_KEY)"
    );
  }
  return new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

export type Esercente = {
  rowNumber: number;
  id: string;
  nomeAttivita: string;
  email: string;
  whatsapp: string;
  tipoAttivita: string;
  linkGoogleMaps: string;
  stato: string;
};

export type Cliente = {
  rowNumber: number;
  submissionId: string;
  nomeCliente: string;
  whatsappCliente: string;
  submittedAt: string;
  stato: string;
  dataOraInvio: string;
};

export const STATO_NON_INVIATO = "Non inviato";
export const STATO_INVIATO = "Inviato";

export async function authenticateEsercente(
  email: string,
  codiceAccesso: string
): Promise<Esercente | null> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${ESERCENTI_SHEET_NAME}!A2:P10000`,
  });
  const rows = res.data.values || [];
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedCode = codiceAccesso.trim();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowEmail = (row[ESERCENTI_COLS.email] || "").trim().toLowerCase();
    const rowCode = (row[ESERCENTI_COLS.codiceAccesso] || "").trim();
    if (rowEmail === normalizedEmail && rowCode && rowCode === normalizedCode) {
      return {
        rowNumber: i + 2,
        id: row[ESERCENTI_COLS.id] || "",
        nomeAttivita: row[ESERCENTI_COLS.nomeAttivita] || "",
        email: row[ESERCENTI_COLS.email] || "",
        whatsapp: row[ESERCENTI_COLS.whatsapp] || "",
        tipoAttivita: row[ESERCENTI_COLS.tipoAttivita] || "",
        linkGoogleMaps: row[ESERCENTI_COLS.linkGoogleMaps] || "",
        stato: row[ESERCENTI_COLS.stato] || "",
      };
    }
  }
  return null;
}

export async function getClientsForEsercente(
  esercenteEmail: string
): Promise<Cliente[]> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CLIENTI_SPREADSHEET_ID,
    range: `${CLIENTI_SHEET_NAME}!A2:K50000`,
  });
  const rows = res.data.values || [];
  const normalizedEmail = esercenteEmail.trim().toLowerCase();

  const out: Cliente[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowEmail = (row[CLIENTI_COLS.emailEsercente] || "").trim().toLowerCase();
    if (rowEmail === normalizedEmail) {
      out.push({
        rowNumber: i + 2,
        submissionId: row[CLIENTI_COLS.submissionId] || "",
        nomeCliente: row[CLIENTI_COLS.nomeCliente] || "",
        whatsappCliente: row[CLIENTI_COLS.whatsappCliente] || "",
        submittedAt: row[CLIENTI_COLS.submittedAt] || "",
        stato: row[CLIENTI_COLS.stato] || "",
        dataOraInvio: row[CLIENTI_COLS.dataOraInvio] || "",
      });
    }
  }
  out.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return out;
}

export type NuovoClienteInput = {
  nomeCliente: string;
  whatsappCliente: string;
};

/**
 * Aggiunge uno o più clienti al foglio Clienti con stato "Non inviato".
 * Non invia alcun messaggio: l'invio è un passo separato ed esplicito
 * (vedi markClientiInviati). Ritorna i submissionId generati, nello stesso
 * ordine dell'input, da usare poi per selezionare/inviare.
 */
export async function addClienti(
  esercenteEmail: string,
  clienti: NuovoClienteInput[],
  origine: string
): Promise<string[]> {
  if (clienti.length === 0) return [];
  const sheets = sheetsClient();
  const now = new Date();
  const submittedAt = now
    .toISOString()
    .slice(0, 16)
    .replace("T", " "); // YYYY-MM-DD HH:mm, ordinabile e confrontabile con i filtri data

  const submissionIds: string[] = [];
  const values = clienti.map((c) => {
    const submissionId = `manuale-${randomUUID()}`;
    submissionIds.push(submissionId);
    const row: string[] = [];
    row[CLIENTI_COLS.submissionId] = submissionId;
    row[CLIENTI_COLS.respondentId] = "";
    row[CLIENTI_COLS.submittedAt] = submittedAt;
    row[CLIENTI_COLS.nomeCliente] = c.nomeCliente;
    row[CLIENTI_COLS.whatsappCliente] = c.whatsappCliente;
    row[CLIENTI_COLS.emailEsercente] = esercenteEmail;
    row[6] = "1"; // colonna "costante", come per le righe create da Tally
    row[CLIENTI_COLS.origine] = origine;
    row[CLIENTI_COLS.stato] = STATO_NON_INVIATO;
    row[CLIENTI_COLS.dataOraInvio] = "";
    // Riempie eventuali buchi (es. colonna H non usata) con stringa vuota
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = "";
    return row;
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: CLIENTI_SPREADSHEET_ID,
    range: `${CLIENTI_SHEET_NAME}!A1:K1`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });

  return submissionIds;
}

/** Recupera il link della scheda Google Maps di un esercente, per email. */
export async function getLinkGoogleMapsEsercente(
  esercenteEmail: string
): Promise<string | null> {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${ESERCENTI_SHEET_NAME}!A2:H10000`,
  });
  const rows = res.data.values || [];
  const normalizedEmail = esercenteEmail.trim().toLowerCase();
  for (const row of rows) {
    if ((row[ESERCENTI_COLS.email] || "").trim().toLowerCase() === normalizedEmail) {
      return row[ESERCENTI_COLS.linkGoogleMaps] || null;
    }
  }
  return null;
}

/**
 * Segna come "Inviato" i clienti (per submissionId) del dato esercente e
 * imposta la data/ora di invio. Usata dopo aver mandato davvero il WhatsApp.
 * Ignora eventuali submissionId non trovati o non appartenenti all'esercente.
 */
export async function markClientiInviati(
  esercenteEmail: string,
  submissionIds: string[]
): Promise<void> {
  if (submissionIds.length === 0) return;
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: CLIENTI_SPREADSHEET_ID,
    range: `${CLIENTI_SHEET_NAME}!A2:K50000`,
  });
  const rows = res.data.values || [];
  const normalizedEmail = esercenteEmail.trim().toLowerCase();
  const wanted = new Set(submissionIds);
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");

  const data: { range: string; values: string[][] }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowEmail = (row[CLIENTI_COLS.emailEsercente] || "").trim().toLowerCase();
    const rowSubmissionId = row[CLIENTI_COLS.submissionId] || "";
    if (rowEmail === normalizedEmail && wanted.has(rowSubmissionId)) {
      const rowNumber = i + 2;
      data.push({
        range: `${CLIENTI_SHEET_NAME}!J${rowNumber}:K${rowNumber}`,
        values: [[STATO_INVIATO, now]],
      });
    }
  }
  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: CLIENTI_SPREADSHEET_ID,
    requestBody: { valueInputOption: "USER_ENTERED", data },
  });
}
