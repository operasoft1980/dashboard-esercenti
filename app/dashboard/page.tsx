import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getEsercenteByEmail, isAbbonamentoAttivo } from "@/lib/sheets";
import { getSubscriptionInfo, descriviPiano } from "@/lib/subscription";
import DashboardClient, { type AbbonamentoView } from "./dashboard-client";

export default async function DashboardPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    redirect("/login");
  }

  // Stato letto ora dal foglio (non dalla sessione, che può essere vecchia
  // fino a 30 giorni): decide se mostrare la funzione di invio recensioni.
  // Il login/accesso alla dashboard resta comunque sempre consentito.
  const esercente = await getEsercenteByEmail(session.email);
  const abbonamentoAttivo = isAbbonamentoAttivo(esercente?.stato);

  // Dettagli in tempo reale da Stripe (piano, prova, disdetta programmata).
  // Se Stripe non risponde, la dashboard funziona lo stesso con i dati del foglio.
  let stripeInfo = null;
  if (esercente?.stripeCustomerId) {
    try {
      stripeInfo = await getSubscriptionInfo(esercente.stripeCustomerId);
    } catch (err) {
      console.error("Lettura abbonamento Stripe non riuscita:", err);
    }
  }

  const abbonamento: AbbonamentoView = {
    stato: esercente?.stato || "",
    statoPagamento: esercente?.statoPagamento || "",
    dataUltimoPagamento: esercente?.dataUltimoPagamento || "",
    dataProssimoRinnovo: esercente?.dataProssimoRinnovo || "",
    dataUltimoFallimento: esercente?.dataUltimoFallimento || "",
    piano: descriviPiano(stripeInfo),
    importo: stripeInfo?.amount ?? null,
    stripeStatus: stripeInfo?.status || "",
    inProva: stripeInfo?.status === "trialing",
    fineProva: stripeInfo?.trialEnd || null,
    disdettaProgrammata: !!stripeInfo?.cancelAtPeriodEnd,
    fineAccesso: stripeInfo?.cancelAt || stripeInfo?.periodEnd || null,
    prossimoRinnovoStripe: stripeInfo?.periodEnd || null,
  };

  return (
    <DashboardClient
      nomeAttivita={session.nomeAttivita}
      email={session.email}
      abbonamentoAttivo={abbonamentoAttivo}
      abbonamento={abbonamento}
    />
  );
}
