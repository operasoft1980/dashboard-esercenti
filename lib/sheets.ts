import { google } from "googleapis";

// ---- Configuration (all via environment variables, never hardcoded) ----
const ESERCENTI_SPREADSHEET_ID = process.env.ESERCENTI_SPREADSHEET_ID!;
const ESERCENTI_SHEET_NAME = process.env.ESERCENTI_SHEET_NAME || "Untitled";
const CLIENTI_SPREADSHEET_ID = process.env.CLIENTI_SPREADSHEET_ID!;
const CLIENTI_SHEET_NAME = process.env.CLIENTI_SHEET_NAME || "Foglio1";

// Column layout (0-indexed) — must match the Make.com scenarios exactly.
// Esercenti (Database Centrale): A ID | B Data Attivazione | C Nome Attività | D Email
// | E WhatsApp | F Tipo Attività | G Link Google Maps | H Stato | I Stripe Customer ID
// | J Stripe Subscription ID | K Stato Pagamento | L Data Ultimo Pagamento
// | M Data Prossimo Rinnovo | N Data Ultimo Fallimento Pagamento | O Ultimo Promemoria
// | P Codice Accesso (added for the dashboard login)
const ESERCENTI_COLS = {
  id: 0,
  dataAttivazione: 1,
  nomeAttivita: 2,
  email: 3,
  whatsapp: 4,
  tipoAttivita: 5,
  linkGoogleMaps: 6,
  stato: 7,
  codiceAccesso: 15, // column P
};

// Clienti (Foglio1): A Submission ID | B Respondent ID | C Submitted at
// | D Nome del Cliente | E Numero WhatsApp del Cliente | F email (=email ESERCENTE)
// | G costante | H - | I Origine | J Stato | K Data/Ora Invio
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

function getAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !key) {
    throw new Error(
      "Credenziali Google mancanti: imposta GOOGLE_SERVICE_ACCOUNT_EMAIL e GOOGLE_PRIVATE_KEY"
    );
  }
  return new google.auth.JWT({
    email,
    key: key.replace(/\\n/g, "\n"),
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
  nomeCliente: string;
  whatsappCliente: string;
  submittedAt: string;
  stato: string;
  dataOraInvio: string;
};

/** Trova l'esercente per email e valida il codice di accesso. */
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

/** Recupera tutti i clienti collegati a un esercente (per email). */
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
        nomeCliente: row[CLIENTI_COLS.nomeCliente] || "",
        whatsappCliente: row[CLIENTI_COLS.whatsappCliente] || "",
        submittedAt: row[CLIENTI_COLS.submittedAt] || "",
        stato: row[CLIENTI_COLS.stato] || "",
        dataOraInvio: row[CLIENTI_COLS.dataOraInvio] || "",
      });
    }
  }
  // Più recenti prima
  out.sort((a, b) => (a.submittedAt < b.submittedAt ? 1 : -1));
  return out;
}
