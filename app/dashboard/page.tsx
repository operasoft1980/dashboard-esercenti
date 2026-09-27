import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";
import { getEsercenteByEmail, isAbbonamentoAttivo } from "@/lib/sheets";
import DashboardClient from "./dashboard-client";

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

  return (
    <DashboardClient
      nomeAttivita={session.nomeAttivita}
      email={session.email}
      abbonamentoAttivo={abbonamentoAttivo}
    />
  );
}
