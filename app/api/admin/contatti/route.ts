import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { isAdminRequest } from "@/lib/adminSession";
import { aggiungiContatti, aggiornaContatti, getCampagna, getContatti, idContatto, type NuovoContatto } from "@/lib/contatti";
import { getAllEsercenti } from "@/lib/sheets";
import { TIPI_ESCLUSI, tipoItaliano } from "@/lib/tipiAttivita";
import { brevoConfigurato, bloccaSuBrevo } from "@/lib/brevo";
import { oggiRomaYmd } from "@/lib/romeTime";

export const maxDuration = 60;

async function guard() {
  return (await isAdminRequest()) ? null : NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
}

/** Elenco contatti + riepilogo + stato invii di oggi. */
export async function GET() {
  const g = await guard();
  if (g) return g;
  try {
    const [contatti, campagna] = await Promise.all([getContatti(), getCampagna()]);
    const oggi = oggiRomaYmd();
    const inviatiOggi = contatti.filter((c) => c.inviato.startsWith(oggi)).length;
    return NextResponse.json({
      contatti,
      inviatiOggi,
      limiteGiornaliero: campagna.limiteGiornaliero,
      brevo: brevoConfigurato(),
    });
  } catch (err) {
    console.error("Contatti: lettura non riuscita", err);
    return NextResponse.json({ error: "Impossibile leggere i contatti dal foglio." }, { status: 502 });
  }
}

const STATI_OK = new Set(["RECEIVING", "UNKNOWN", ""]);
const PRIORITA: Record<string, number> = { RECEIVING: 0, UNKNOWN: 1, "": 2 };

/**
 * Importa un file Excel esportato da Outscraper (Google Maps).
 * Regole: niente email non valide o in blacklist, niente enti pubblici,
 * una sola email per attività, niente doppioni con contatti già presenti
 * né con esercenti già clienti.
 */
export async function POST(req: NextRequest) {
  const g = await guard();
  if (g) return g;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "Nessun file ricevuto" }, { status: 400 });
  }
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(await file.arrayBuffer()) as unknown as ArrayBuffer);
  } catch {
    return NextResponse.json({ error: "File non leggibile: serve un .xlsx esportato da Outscraper" }, { status: 400 });
  }
  const ws = wb.worksheets[0];
  if (!ws) return NextResponse.json({ error: "Il file è vuoto" }, { status: 400 });

  const header: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, col) => {
    header[String(cell.value ?? "").trim()] = col;
  });
  if (!header["email"] || !header["name"]) {
    return NextResponse.json({ error: "Colonne 'name' ed 'email' non trovate: è un export Outscraper?" }, { status: 400 });
  }
  const val = (row: ExcelJS.Row, k: string): string => {
    const c = header[k];
    if (!c) return "";
    const v = row.getCell(c).value as unknown;
    if (v == null) return "";
    if (typeof v === "object") {
      const o = v as { text?: string; hyperlink?: string; result?: unknown };
      return String(o.text ?? o.hyperlink ?? o.result ?? "");
    }
    return String(v);
  };

  const [esistenti, esercenti] = await Promise.all([getContatti(), getAllEsercenti()]);
  const emailNote = new Set([...esistenti.map((c) => c.email), ...esercenti.map((e) => e.email.toLowerCase())]);
  const idNoti = new Set(esistenti.map((c) => c.id));

  const scarti = { senzaEmail: 0, nonValide: 0, esclusi: 0, giaPresenti: 0, stessaAttivita: 0 };
  const perAttivita = new Map<string, NuovoContatto & { prio: number }>();
  const oggi = oggiRomaYmd();
  const fonte = String(val(ws.getRow(2), "query") || (file as File).name || "").slice(0, 120);

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const email = val(row, "email").trim().toLowerCase();
    if (!email || !email.includes("@")) {
      scarti.senzaEmail++;
      continue;
    }
    const stato = val(row, "email.emails_validator.status").toUpperCase();
    if (!STATI_OK.has(stato)) {
      scarti.nonValide++;
      continue;
    }
    const tipoEn = val(row, "type") || val(row, "category");
    if (TIPI_ESCLUSI.has(tipoEn) || val(row, "business_status") === "CLOSED_PERMANENTLY") {
      scarti.esclusi++;
      continue;
    }
    const placeId = val(row, "place_id");
    const id = idContatto(placeId, email);
    if (emailNote.has(email) || idNoti.has(id)) {
      scarti.giaPresenti++;
      continue;
    }
    const nuovo = {
      id,
      email,
      nome: val(row, "name").trim(),
      tipo: tipoItaliano(tipoEn),
      citta: val(row, "city").trim(),
      telefono: val(row, "phone").trim(),
      sito: val(row, "website").trim(),
      voto: Number(val(row, "rating")) || null,
      recensioni: Number(val(row, "reviews")) || (val(row, "reviews") === "0" ? 0 : null),
      linkMaps: val(row, "location_link") || val(row, "reviews_link"),
      fonte,
      importato: oggi,
      validazione: stato || "—",
      prio: PRIORITA[stato] ?? 3,
    };
    const prec = perAttivita.get(id);
    if (prec) {
      scarti.stessaAttivita++;
      if (nuovo.prio < prec.prio) perAttivita.set(id, nuovo);
    } else {
      perAttivita.set(id, nuovo);
    }
  }

  // Doppioni di email tra attività diverse (es. catene): tieni la prima.
  const viste = new Set<string>();
  const daAggiungere: NuovoContatto[] = [];
  for (const { prio: _p, ...c } of perAttivita.values()) {
    void _p;
    if (viste.has(c.email)) {
      scarti.stessaAttivita++;
      continue;
    }
    viste.add(c.email);
    daAggiungere.push(c);
  }

  try {
    await aggiungiContatti(daAggiungere);
  } catch (err) {
    console.error("Contatti: salvataggio non riuscito", err);
    return NextResponse.json({ error: "Salvataggio nel foglio non riuscito" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, importati: daAggiungere.length, righe: ws.rowCount - 1, scarti, fonte });
}

/** Blocca/sblocca o annota contatti. */
export async function PATCH(req: NextRequest) {
  const g = await guard();
  if (g) return g;
  const b = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(b?.ids) ? b.ids : [];
  if (!ids.length) return NextResponse.json({ error: "Nessun contatto" }, { status: 400 });
  const contatti = await getContatti();
  const sel = contatti.filter((c) => ids.includes(c.id));
  await aggiornaContatti(
    sel.map((c) => ({
      riga: c.riga,
      ...(typeof b.bloccato === "boolean" ? { bloccato: b.bloccato } : {}),
      ...(typeof b.note === "string" ? { note: b.note.slice(0, 300) } : {}),
    }))
  );
  if (b.bloccato === true) await Promise.all(sel.map((c) => bloccaSuBrevo(c.email)));
  return NextResponse.json({ ok: true, aggiornati: sel.length });
}
