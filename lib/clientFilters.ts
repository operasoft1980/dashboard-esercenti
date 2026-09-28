import { sheetDay } from "@/lib/dates";

/** Valori del filtro "Recensione" in dashboard. */
export const FILTRI_STELLE = [
  { value: "", label: "Tutte" },
  { value: "recensiti", label: "Hanno recensito" },
  { value: "nessuna", label: "Non hanno recensito" },
  { value: "positive", label: "4–5 stelle (su Google)" },
  { value: "negative", label: "1–3 stelle (private)" },
  { value: "5", label: "5 stelle" },
  { value: "4", label: "4 stelle" },
  { value: "3", label: "3 stelle" },
  { value: "2", label: "2 stelle" },
  { value: "1", label: "1 stella" },
] as const;

export type ClientFilters = {
  stato?: string | null;
  dataDa?: string | null;
  dataA?: string | null;
  stelle?: string | null;
  cerca?: string | null;
};

type Filtrabile = {
  stato: string;
  submittedAt: string;
  stelle: number | null;
  nomeCliente: string;
  whatsappCliente: string;
};

function matchStelle(stelle: number | null, filtro: string): boolean {
  switch (filtro) {
    case "":
      return true;
    case "recensiti":
      return stelle !== null;
    case "nessuna":
      return stelle === null;
    case "positive":
      return stelle !== null && stelle >= 4;
    case "negative":
      return stelle !== null && stelle <= 3;
    default: {
      const n = parseInt(filtro, 10);
      return Number.isFinite(n) ? stelle === n : true;
    }
  }
}

/** Stessi filtri per tabella, statistiche ed export (Excel/PDF). */
export function applyClientFilters<T extends Filtrabile>(clients: T[], f: ClientFilters): T[] {
  const cerca = (f.cerca || "").trim().toLowerCase();
  const cercaCifre = cerca.replace(/\D/g, "");
  return clients.filter((c) => {
    if (f.stato && c.stato !== f.stato) return false;
    // Confronto sul solo giorno: con "A = 28/09" vanno inclusi anche i clienti
    // registrati il 28/09 in qualsiasi ora.
    const giorno = sheetDay(c.submittedAt);
    if (f.dataDa && (!giorno || giorno < f.dataDa)) return false;
    if (f.dataA && (!giorno || giorno > f.dataA)) return false;
    if (!matchStelle(c.stelle, f.stelle || "")) return false;
    if (cerca) {
      const inNome = c.nomeCliente.toLowerCase().includes(cerca);
      const inNumero = cercaCifre.length >= 3 && c.whatsappCliente.replace(/\D/g, "").includes(cercaCifre);
      if (!inNome && !inNumero) return false;
    }
    return true;
  });
}

export function filtersFromSearchParams(sp: URLSearchParams): ClientFilters {
  return {
    stato: sp.get("stato"),
    dataDa: sp.get("dataDa"),
    dataA: sp.get("dataA"),
    stelle: sp.get("stelle"),
    cerca: sp.get("cerca"),
  };
}
