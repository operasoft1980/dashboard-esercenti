/**
 * Calcoli del bilancino (funzioni pure, senza accesso a Stripe o al foglio):
 * ripartizione dei costi nel periodo, riepilogo mensile, utile e indici.
 */

export type Ricorrenza = "Una tantum" | "Mensile" | "Trimestrale" | "Annuale";
export const RICORRENZE: Ricorrenza[] = ["Una tantum", "Mensile", "Trimestrale", "Annuale"];

export const CATEGORIE_COSTO = [
  "Software e abbonamenti",
  "Hosting e dominio",
  "WhatsApp / messaggi",
  "Marketing e pubblicità",
  "Consulenze e commercialista",
  "Tasse e contributi",
  "Altro",
] as const;

export type Costo = {
  id: string;
  data: string; // YYYY-MM-DD: data (o prima data, se ricorrente)
  descrizione: string;
  categoria: string;
  importo: number; // euro, per singola occorrenza
  ricorrenza: Ricorrenza;
  dataFine: string; // YYYY-MM-DD o vuoto = ancora attivo
};

export type OccorrenzaCosto = {
  costoId: string;
  data: string;
  descrizione: string;
  categoria: string;
  importo: number;
};

const MESI_PER: Record<Ricorrenza, number> = {
  "Una tantum": 0,
  Mensile: 1,
  Trimestrale: 3,
  Annuale: 12,
};

/** Aggiunge n mesi a "YYYY-MM-DD" tenendo il giorno (31 → ultimo giorno del mese). */
export function addMesi(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  const totale = y * 12 + (m - 1) + n;
  const ny = Math.floor(totale / 12);
  const nm = (totale % 12) + 1;
  const ultimo = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  const nd = Math.min(d, ultimo);
  return `${ny}-${String(nm).padStart(2, "0")}-${String(nd).padStart(2, "0")}`;
}

/**
 * Occorrenze dei costi tra da e a (inclusi). Le ricorrenze si fermano alla
 * data di fine del costo e comunque a "oggi": il bilancino confronta incassi
 * reali con costi già maturati, non con costi futuri.
 */
export function occorrenzeCosti(costi: Costo[], da: string, a: string, oggi: string): OccorrenzaCosto[] {
  const out: OccorrenzaCosto[] = [];
  const limite = a < oggi ? a : oggi;
  for (const c of costi) {
    if (!c.data || !(c.importo > 0)) continue;
    const passo = MESI_PER[c.ricorrenza] ?? 0;
    const fine = c.dataFine && c.dataFine < limite ? c.dataFine : limite;
    if (passo === 0) {
      if (c.data >= da && c.data <= fine) out.push(occ(c, c.data));
      continue;
    }
    for (let i = 0; i < 1200; i++) {
      const d = addMesi(c.data, i * passo);
      if (d > fine) break;
      if (d >= da) out.push(occ(c, d));
    }
  }
  return out.sort((x, y) => (x.data < y.data ? -1 : 1));
}

function occ(c: Costo, data: string): OccorrenzaCosto {
  return { costoId: c.id, data, descrizione: c.descrizione, categoria: c.categoria, importo: c.importo };
}

/** Elenco dei mesi "YYYY-MM" compresi tra due date. */
export function mesiTra(da: string, a: string): string[] {
  const out: string[] = [];
  let cur = da.slice(0, 7) + "-01";
  const fine = a.slice(0, 7);
  for (let i = 0; i < 600 && cur.slice(0, 7) <= fine; i++) {
    out.push(cur.slice(0, 7));
    cur = addMesi(cur, 1);
  }
  return out;
}

export function giorniTra(da: string, a: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(a) - t(da)) / 86400000) + 1;
}

export type Incassi = {
  lordo: number; // incassato dai clienti
  rimborsi: number; // valore positivo
  commissioni: number; // commissioni Stripe, valore positivo
};

export type Parametri = {
  capitaleProprio: number | null;
  capitaleInvestito: number | null;
  aliquotaImposte: number | null; // percentuale, es. 15
};

export type ContoEconomico = {
  ricaviLordi: number;
  rimborsi: number;
  ricaviNetti: number;
  commissioni: number;
  margineLordo: number;
  costi: number;
  utileAnteImposte: number;
  imposte: number;
  utileNetto: number;
  marginePct: number | null; // utile netto / ricavi netti
  ros: number | null; // utile operativo / ricavi netti
  roi: number | null; // utile operativo / capitale investito
  roe: number | null; // utile netto / capitale proprio
  roiAnnuo: number | null;
  roeAnnuo: number | null;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function contoEconomico(inc: Incassi, costi: number, p: Parametri, giorni: number): ContoEconomico {
  const ricaviNetti = inc.lordo - inc.rimborsi;
  const margineLordo = ricaviNetti - inc.commissioni;
  const utileAnteImposte = margineLordo - costi;
  const aliquota = p.aliquotaImposte && p.aliquotaImposte > 0 ? p.aliquotaImposte / 100 : 0;
  const imposte = utileAnteImposte > 0 ? utileAnteImposte * aliquota : 0;
  const utileNetto = utileAnteImposte - imposte;
  const annuo = giorni > 0 ? 365 / giorni : 1;
  const roi = p.capitaleInvestito && p.capitaleInvestito > 0 ? utileAnteImposte / p.capitaleInvestito : null;
  const roe = p.capitaleProprio && p.capitaleProprio > 0 ? utileNetto / p.capitaleProprio : null;
  return {
    ricaviLordi: r2(inc.lordo),
    rimborsi: r2(inc.rimborsi),
    ricaviNetti: r2(ricaviNetti),
    commissioni: r2(inc.commissioni),
    margineLordo: r2(margineLordo),
    costi: r2(costi),
    utileAnteImposte: r2(utileAnteImposte),
    imposte: r2(imposte),
    utileNetto: r2(utileNetto),
    marginePct: ricaviNetti > 0 ? utileNetto / ricaviNetti : null,
    ros: ricaviNetti > 0 ? utileAnteImposte / ricaviNetti : null,
    roi,
    roe,
    roiAnnuo: roi != null ? roi * annuo : null,
    roeAnnuo: roe != null ? roe * annuo : null,
  };
}

/** Dati minimi di un abbonamento per MRR, nuovi, disdette e churn. */
export type SubLite = {
  status: string;
  start: number; // epoch s
  endedAt: number | null;
  mrr: number; // euro/mese normalizzati
};

export type MetricheAbbonamenti = {
  attivi: number; // paganti (active + past_due)
  inProva: number;
  inRitardo: number;
  mrr: number;
  arr: number;
  arpu: number | null;
  attiviInizioPeriodo: number;
  nuovi: number;
  cessati: number;
  churnPct: number | null;
};

export function metricheAbbonamenti(subs: SubLite[], daTs: number, aTs: number): MetricheAbbonamenti {
  const vivi = ["active", "past_due", "unpaid"];
  const paganti = subs.filter((s) => vivi.includes(s.status));
  const mrr = paganti.filter((s) => s.status !== "unpaid").reduce((t, s) => t + s.mrr, 0);
  const validi = subs.filter((s) => !s.status.startsWith("incomplete"));
  const attiviInizio = validi.filter((s) => s.start < daTs && (s.endedAt == null || s.endedAt >= daTs)).length;
  const cessati = validi.filter((s) => s.endedAt != null && s.endedAt >= daTs && s.endedAt <= aTs).length;
  return {
    attivi: paganti.length,
    inProva: subs.filter((s) => s.status === "trialing").length,
    inRitardo: subs.filter((s) => s.status === "past_due" || s.status === "unpaid").length,
    mrr: r2(mrr),
    arr: r2(mrr * 12),
    arpu: paganti.length ? r2(mrr / paganti.length) : null,
    attiviInizioPeriodo: attiviInizio,
    nuovi: validi.filter((s) => s.start >= daTs && s.start <= aTs).length,
    cessati,
    churnPct: attiviInizio > 0 ? cessati / attiviInizio : null,
  };
}
