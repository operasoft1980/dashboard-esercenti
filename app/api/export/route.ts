import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import ExcelJS from "exceljs";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getClientsForEsercente } from "@/lib/sheets";

export async function GET(req: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;
  if (!session) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  const clients = await getClientsForEsercente(session.email);

  const { searchParams } = new URL(req.url);
  const stato = searchParams.get("stato");
  const dataDa = searchParams.get("dataDa");
  const dataA = searchParams.get("dataA");

  let filtered = clients;
  if (stato) filtered = filtered.filter((c) => c.stato === stato);
  if (dataDa) filtered = filtered.filter((c) => c.submittedAt >= dataDa);
  if (dataA) filtered = filtered.filter((c) => c.submittedAt <= dataA);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Clienti");
  sheet.columns = [
    { header: "Nome Cliente", key: "nomeCliente", width: 30 },
    { header: "WhatsApp", key: "whatsappCliente", width: 18 },
    { header: "Data Registrazione", key: "submittedAt", width: 20 },
    { header: "Stato", key: "stato", width: 16 },
    { header: "Data/Ora Invio", key: "dataOraInvio", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF4472C4" },
  };
  filtered.forEach((c) => sheet.addRow(c));

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `clienti_${session.nomeAttivita.replace(/[^a-z0-9]/gi, "_")}.xlsx`;

  return new NextResponse(buffer as any, {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
    },
  });
}
