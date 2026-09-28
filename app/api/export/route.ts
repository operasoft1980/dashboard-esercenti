import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getClientsForEsercente, type Cliente } from "@/lib/sheets";
import { applyClientFilters, filtersFromSearchParams, type ClientFilters } from "@/lib/clientFilters";
import { formatDataIt } from "@/lib/dates";

async function buildWorkbook(nomeAttivita: string, rows: Cliente[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clienti");
  sheet.columns = [
    { header: "Nome Cliente", key: "nomeCliente", width: 28 },
    { header: "WhatsApp", key: "whatsappCliente", width: 18 },
    { header: "Data Registrazione", key: "registrato", width: 20 },
    { header: "Stato", key: "stato", width: 14 },
    { header: "Data/Ora Invio", key: "invio", width: 20 },
    { header: "Stelle", key: "stelle", width: 8 },
    { header: "Commento", key: "commento", width: 45 },
    { header: "Data Recensione", key: "dataRecensione", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1FAE58" } };
  rows.forEach((c) =>
    sheet.addRow({
      nomeCliente: c.nomeCliente,
      whatsappCliente: c.whatsappCliente,
      registrato: formatDataIt(c.submittedAt, true),
      stato: c.stato,
      invio: c.dataOraInvio ? formatDataIt(c.dataOraInvio, true) : "",
      stelle: c.stelle ?? "",
      commento: c.commento,
      dataRecensione: c.dataRecensione ? formatDataIt(c.dataRecensione, true) : "",
    })
  );
  sheet.getColumn("commento").alignment = { wrapText: true, vertical: "top" };
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `clienti_${nomeAttivita.replace(/[^a-z0-9]/gi, "_")}.xlsx`;
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}

async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  return token ? await verifySessionToken(token) : null;
}

/** Export dell'elenco filtrato (compatibilità con i link diretti). */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const clients = await getClientsForEsercente(session.email);
  const filtered = applyClientFilters(clients, filtersFromSearchParams(new URL(req.url).searchParams));
  return buildWorkbook(session.nomeAttivita, filtered);
}

/**
 * Export dei clienti selezionati (submissionIds) oppure, se la selezione è
 * vuota, dell'elenco filtrato. I dati sono sempre riletti dal foglio e
 * limitati ai clienti dell'esercente loggato.
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.submissionIds) ? body.submissionIds : [];
  const filters: ClientFilters = body?.filters || {};

  const clients = await getClientsForEsercente(session.email);
  let rows: Cliente[];
  if (ids.length > 0) {
    const wanted = new Set(ids);
    rows = clients.filter((c) => wanted.has(c.submissionId));
  } else {
    rows = applyClientFilters(clients, filters);
  }
  return buildWorkbook(session.nomeAttivita, rows);
}
