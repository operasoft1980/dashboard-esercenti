import { NextRequest, NextResponse } from "next/server";
import { aggiornaContatti, getContatti } from "@/lib/contatti";
import { bloccaSuBrevo, verificaDisiscrizione } from "@/lib/brevo";
import { romeDateTime } from "@/lib/romeTime";

/**
 * Link di disiscrizione presente in ogni email di prospezione (pubblico,
 * protetto da firma). GET mostra la conferma; POST è il "one-click" usato
 * da Gmail/Outlook tramite l'intestazione List-Unsubscribe.
 */
async function disiscrivi(email: string) {
  const contatti = await getContatti();
  const trovati = contatti.filter((c) => c.email === email);
  await aggiornaContatti(
    trovati.map((c) => ({
      riga: c.riga,
      stato: "Disiscritto" as const,
      bloccato: true,
      ultimoEvento: "Disiscritto dal link",
      dataUltimoEvento: romeDateTime(),
    }))
  );
  await bloccaSuBrevo(email);
}

function pagina(titolo: string, testo: string, status = 200) {
  return new NextResponse(
    `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titolo}</title></head>
<body style="margin:0;background:#f6f4ef;font-family:Arial,Helvetica,sans-serif;color:#111b21">
<div style="max-width:480px;margin:60px auto;background:#fff;border:1px solid #e4e0d6;border-radius:14px;padding:32px;text-align:center">
<div style="font-family:Georgia,serif;font-size:22px;font-weight:bold">Recensioni a 5 Stelle</div>
<h1 style="font-size:20px;margin:20px 0 10px">${titolo}</h1><p style="color:#5b6670;line-height:1.5">${testo}</p></div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const email = verificaDisiscrizione(sp.get("e") || "", sp.get("t") || "");
  if (!email) return pagina("Link non valido", "Il link di disiscrizione non è valido o è incompleto.", 400);
  try {
    await disiscrivi(email);
  } catch (err) {
    console.error("Disiscrizione non riuscita", err);
    return pagina("Qualcosa non ha funzionato", "Riprova tra qualche minuto oppure rispondi alla nostra email scrivendo \"disiscrivimi\".", 500);
  }
  return pagina("Disiscrizione completata", `L'indirizzo <b>${email.replace(/</g, "")}</b> non riceverà più email da Recensioni a 5 Stelle. Ci scusiamo per il disturbo.`);
}

export async function POST(req: NextRequest) {
  const sp = new URL(req.url).searchParams;
  const email = verificaDisiscrizione(sp.get("e") || "", sp.get("t") || "");
  if (!email) return NextResponse.json({ error: "Link non valido" }, { status: 400 });
  await disiscrivi(email).catch((err) => console.error("Disiscrizione one-click non riuscita", err));
  return NextResponse.json({ ok: true });
}
