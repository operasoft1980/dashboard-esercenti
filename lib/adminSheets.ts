import { randomUUID } from "crypto";
import { sheetsClient, ESERCENTI_SPREADSHEET_ID, ESERCENTI_SHEET_NAME } from "@/lib/sheets";
import { RICORRENZE, type Costo, type Parametri, type Ricorrenza } from "@/lib/bilancioCalc";

/**
 * Dati dell'area admin salvati nel foglio "Database Centrale":
 * - scheda "Costi": costi di gestione (una tantum o ricorrenti)
 * - scheda "Parametri": capitale proprio, capitale investito, aliquota imposte
 * - colonne Q/R della scheda esercenti: contatori promemoria/solleciti (Make)
 * Le schede e le intestazioni mancanti vengono create al primo utilizzo.
 */
const COSTI = "Costi";
const PARAMETRI = "Parametri";
const COSTI_HEADER = ["ID", "Data", "Descrizione", "Categoria", "Importo", "Ricorrenza", "Data fine"];
const PARAMETRI_HEADER = ["Chiave", "Valore"];

let setupFatto = false;

async function sheetIds(): Promise<Record<string, number>> {
  const res = await sheetsClient().spreadsheets.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    fields: "sheets.properties(sheetId,title)",
  });
  const out: Record<string, number> = {};
  for (const s of res.data.sheets || []) {
    if (s.properties?.title != null && s.properties.sheetId != null) out[s.properties.title] = s.properties.sheetId;
  }
  return out;
}

export async function ensureAdminSetup(): Promise<void> {
  if (setupFatto) return;
  const sheets = sheetsClient();
  const ids = await sheetIds();
  const mancanti = [COSTI, PARAMETRI].filter((t) => ids[t] == null);
  if (mancanti.length) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: ESERCENTI_SPREADSHEET_ID,
      requestBody: { requests: mancanti.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
  const head = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    ranges: [`${COSTI}!A1:G1`, `${PARAMETRI}!A1:B1`, `${ESERCENTI_SHEET_NAME}!Q1:R1`],
  });
  const [hc, hp, hq] = (head.data.valueRanges || []).map((v) => v.values?.[0] || []);
  const data: { range: string; values: string[][] }[] = [];
  if (!hc.length) data.push({ range: `${COSTI}!A1:G1`, values: [COSTI_HEADER] });
  if (!hp.length) data.push({ range: `${PARAMETRI}!A1:B1`, values: [PARAMETRI_HEADER] });
  if (!hq.length) {
    data.push({
      range: `${ESERCENTI_SHEET_NAME}!Q1:R1`,
      values: [["N. Promemoria Rinnovo", "N. Solleciti Pagamento"]],
    });
  }
  if (data.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: ESERCENTI_SPREADSHEET_ID,
      requestBody: { valueInputOption: "RAW", data },
    });
  }
  setupFatto = true;
}

function numero(v: string | undefined): number {
  const s = (v || "").toString().trim().replace(/\s|€/g, "");
  if (!s) return NaN;
  // accetta "1.234,56", "1234,56" e "1234.56"
  const norm = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return parseFloat(norm);
}

export async function getCosti(): Promise<Costo[]> {
  await ensureAdminSetup();
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${COSTI}!A2:G5000`,
  });
  return (res.data.values || [])
    .map((r) => ({
      id: (r[0] || "").toString(),
      data: (r[1] || "").toString().slice(0, 10),
      descrizione: (r[2] || "").toString(),
      categoria: (r[3] || "").toString(),
      importo: numero(r[4]),
      ricorrenza: (RICORRENZE.includes(r[5]) ? r[5] : "Una tantum") as Ricorrenza,
      dataFine: (r[6] || "").toString().slice(0, 10),
    }))
    .filter((c) => c.id && c.data && Number.isFinite(c.importo));
}

export async function addCosto(c: Omit<Costo, "id">): Promise<Costo> {
  await ensureAdminSetup();
  const nuovo: Costo = { ...c, id: randomUUID() };
  await sheetsClient().spreadsheets.values.append({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${COSTI}!A1:G1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[nuovo.id, nuovo.data, nuovo.descrizione, nuovo.categoria, nuovo.importo, nuovo.ricorrenza, nuovo.dataFine]],
    },
  });
  return nuovo;
}

/** Aggiorna solo la data di fine (per chiudere un costo ricorrente senza perderne lo storico). */
export async function setFineCosto(id: string, dataFine: string): Promise<boolean> {
  const riga = await rigaCosto(id);
  if (!riga) return false;
  await sheetsClient().spreadsheets.values.update({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${COSTI}!G${riga}`,
    valueInputOption: "RAW",
    requestBody: { values: [[dataFine]] },
  });
  return true;
}

async function rigaCosto(id: string): Promise<number | null> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${COSTI}!A2:A5000`,
  });
  const idx = (res.data.values || []).findIndex((r) => r[0] === id);
  return idx < 0 ? null : idx + 2;
}

export async function deleteCosto(id: string): Promise<boolean> {
  await ensureAdminSetup();
  const riga = await rigaCosto(id);
  if (!riga) return false;
  const ids = await sheetIds();
  await sheetsClient().spreadsheets.batchUpdate({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    requestBody: {
      requests: [
        { deleteDimension: { range: { sheetId: ids[COSTI], dimension: "ROWS", startIndex: riga - 1, endIndex: riga } } },
      ],
    },
  });
  return true;
}

const CHIAVI: Record<keyof Parametri, string> = {
  capitaleProprio: "Capitale proprio",
  capitaleInvestito: "Capitale investito",
  aliquotaImposte: "Aliquota imposte %",
};

export async function getParametri(): Promise<Parametri> {
  await ensureAdminSetup();
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${PARAMETRI}!A2:B50`,
  });
  const map = new Map((res.data.values || []).map((r) => [(r[0] || "").toString(), (r[1] || "").toString()]));
  const val = (k: keyof Parametri) => {
    const n = numero(map.get(CHIAVI[k]));
    return Number.isFinite(n) ? n : null;
  };
  return {
    capitaleProprio: val("capitaleProprio"),
    capitaleInvestito: val("capitaleInvestito"),
    aliquotaImposte: val("aliquotaImposte"),
  };
}

export async function saveParametri(p: Parametri): Promise<void> {
  await ensureAdminSetup();
  const righe = (Object.keys(CHIAVI) as (keyof Parametri)[]).map((k) => [CHIAVI[k], p[k] == null ? "" : String(p[k])]);
  await sheetsClient().spreadsheets.values.update({
    spreadsheetId: ESERCENTI_SPREADSHEET_ID,
    range: `${PARAMETRI}!A2:B${righe.length + 1}`,
    valueInputOption: "RAW",
    requestBody: { values: righe },
  });
}
