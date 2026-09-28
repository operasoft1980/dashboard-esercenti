import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/adminSession";
import { addCosto, deleteCosto, setFineCosto } from "@/lib/adminSheets";
import { RICORRENZE, type Ricorrenza } from "@/lib/bilancioCalc";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

async function guard() {
  return (await isAdminRequest()) ? null : NextResponse.json({ error: "Non autorizzato" }, { status: 401 });
}

/** Nuovo costo di gestione. */
export async function POST(req: NextRequest) {
  const g = await guard();
  if (g) return g;
  const b = await req.json().catch(() => null);
  const data = typeof b?.data === "string" ? b.data : "";
  const descrizione = typeof b?.descrizione === "string" ? b.descrizione.trim().slice(0, 200) : "";
  const categoria = typeof b?.categoria === "string" ? b.categoria.trim().slice(0, 60) : "Altro";
  const importo = Number(b?.importo);
  const ricorrenza: Ricorrenza = RICORRENZE.includes(b?.ricorrenza) ? b.ricorrenza : "Una tantum";
  const dataFine = typeof b?.dataFine === "string" && YMD.test(b.dataFine) ? b.dataFine : "";
  if (!YMD.test(data) || !descrizione || !(importo > 0)) {
    return NextResponse.json({ error: "Inserisci data, descrizione e un importo maggiore di zero." }, { status: 400 });
  }
  if (dataFine && dataFine < data) {
    return NextResponse.json({ error: "La data di fine è precedente alla data di inizio." }, { status: 400 });
  }
  try {
    const costo = await addCosto({ data, descrizione, categoria, importo: Math.round(importo * 100) / 100, ricorrenza, dataFine });
    return NextResponse.json({ ok: true, costo });
  } catch (err) {
    console.error("Costi: salvataggio non riuscito", err);
    return NextResponse.json({ error: "Salvataggio nel foglio non riuscito." }, { status: 502 });
  }
}

/** Chiude un costo ricorrente da una certa data (resta nello storico). */
export async function PATCH(req: NextRequest) {
  const g = await guard();
  if (g) return g;
  const b = await req.json().catch(() => null);
  if (typeof b?.id !== "string" || typeof b?.dataFine !== "string" || !YMD.test(b.dataFine)) {
    return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  }
  const ok = await setFineCosto(b.id, b.dataFine);
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: "Costo non trovato" }, { status: 404 });
}

/** Elimina un costo inserito per errore. */
export async function DELETE(req: NextRequest) {
  const g = await guard();
  if (g) return g;
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "ID mancante" }, { status: 400 });
  const ok = await deleteCosto(id);
  return ok ? NextResponse.json({ ok }) : NextResponse.json({ error: "Costo non trovato" }, { status: 404 });
}
