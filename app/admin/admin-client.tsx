"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EsercenteAdminRow } from "@/app/api/admin/esercenti/route";
import { formatDataIt, giorniDaOggi } from "@/lib/dates";

const REFRESH_MS = 60_000;

type SubInfo = {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  trialEnd: string | null;
  periodEnd: string | null;
  amount: number | null;
};

type Situazione = "ritardo" | "disdetto" | "rinnovo7" | "attivo" | "altro";

function situazione(e: EsercenteAdminRow): Situazione {
  const stato = e.stato.trim().toLowerCase();
  const pag = e.statoPagamento.trim().toLowerCase();
  if (stato === "in ritardo" || pag === "non pagato") return "ritardo";
  if (stato === "disdetto") return "disdetto";
  if (stato === "attivo") {
    const g = giorniDaOggi(e.dataProssimoRinnovo);
    if (g != null && g >= 0 && g <= 7) return "rinnovo7";
    return "attivo";
  }
  return "altro";
}

const SITUAZIONE_BADGE: Record<Situazione, { label: string; cls: string }> = {
  ritardo: { label: "In ritardo", cls: "bg-red-100 text-red-700" },
  disdetto: { label: "Disdetto", cls: "bg-gray-200 text-gray-700" },
  rinnovo7: { label: "Rinnovo ≤ 7 gg", cls: "bg-amber-100 text-amber-800" },
  attivo: { label: "Attivo", cls: "bg-green-100 text-green-700" },
  altro: { label: "Altro", cls: "bg-gray-100 text-gray-600" },
};

const FILTRI_SITUAZIONE = [
  { value: "", label: "Tutte" },
  { value: "attivi", label: "Attivi (compresi rinnovi vicini)" },
  { value: "ritardo", label: "In ritardo di pagamento" },
  { value: "rinnovo7", label: "Rinnovo entro 7 giorni" },
  { value: "rinnovo30", label: "Rinnovo entro 30 giorni" },
  { value: "disdetto", label: "Disdetti" },
  { value: "senzaClienti", label: "Nessun cliente caricato" },
  { value: "maiInviato", label: "Mai inviato richieste" },
];

type SortKey =
  | "nomeAttivita"
  | "tipoAttivita"
  | "situazione"
  | "dataAttivazione"
  | "dataProssimoRinnovo"
  | "clienti"
  | "inviati"
  | "recensiti"
  | "tasso"
  | "media"
  | "ultimoCliente";

const tasso = (e: { inviati: number; recensiti: number }) => (e.inviati > 0 ? e.recensiti / e.inviati : -1);
const media = (e: { recensiti: number; sommaStelle: number }) => (e.recensiti > 0 ? e.sommaStelle / e.recensiti : -1);
const pct = (v: number) => (v < 0 ? "—" : `${Math.round(v * 100)}%`);
const stelleFmt = (v: number) => (v < 0 ? "—" : v.toFixed(1).replace(".", ","));

export default function AdminClient() {
  const router = useRouter();
  const [rows, setRows] = useState<EsercenteAdminRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const [cerca, setCerca] = useState("");
  const [tipo, setTipo] = useState("");
  const [sit, setSit] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("dataAttivazione");
  const [sortAsc, setSortAsc] = useState(false);
  const [tipoSort, setTipoSort] = useState<"esercenti" | "recensiti" | "tasso" | "media" | "perEsercente">("esercenti");
  const [aperto, setAperto] = useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await fetch("/api/admin/esercenti", { cache: "no-store" });
        if (res.status === 401) {
          router.push("/admin/login");
          return;
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Errore");
        setRows(data.esercenti || []);
        setLastUpdated(new Date());
        setErrore("");
      } catch (e) {
        setErrore(e instanceof Error ? e.message : "Caricamento non riuscito");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [router]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") load(true);
    };
    const id = window.setInterval(tick, REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [load]);

  async function logout() {
    await fetch("/api/admin/session", { method: "DELETE" });
    router.push("/admin/login");
  }

  const tipi = useMemo(
    () => Array.from(new Set(rows.map((r) => r.tipoAttivita || "Non indicato"))).sort(),
    [rows]
  );

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    return rows.filter((e) => {
      if (tipo && (e.tipoAttivita || "Non indicato") !== tipo) return false;
      if (q && !`${e.nomeAttivita} ${e.email} ${e.whatsapp}`.toLowerCase().includes(q)) return false;
      const s = situazione(e);
      switch (sit) {
        case "attivi":
          return s === "attivo" || s === "rinnovo7";
        case "ritardo":
        case "disdetto":
        case "rinnovo7":
          return s === sit;
        case "rinnovo30": {
          const g = giorniDaOggi(e.dataProssimoRinnovo);
          return (s === "attivo" || s === "rinnovo7") && g != null && g >= 0 && g <= 30;
        }
        case "senzaClienti":
          return e.clienti === 0;
        case "maiInviato":
          return e.inviati === 0;
      }
      return true;
    });
  }, [rows, cerca, tipo, sit]);

  const ordinati = useMemo(() => {
    const val = (e: EsercenteAdminRow): string | number => {
      switch (sortKey) {
        case "tasso":
          return tasso(e);
        case "media":
          return media(e);
        case "situazione":
          return SITUAZIONE_BADGE[situazione(e)].label;
        case "dataAttivazione":
        case "dataProssimoRinnovo":
        case "ultimoCliente": {
          const d = e[sortKey];
          const g = giorniDaOggi(d);
          return g == null ? Number.NEGATIVE_INFINITY : g;
        }
        default:
          return e[sortKey] as string | number;
      }
    };
    return [...filtrati].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "it");
      return sortAsc ? cmp : -cmp;
    });
  }, [filtrati, sortKey, sortAsc]);

  const kpi = useMemo(() => {
    const k = { tot: rows.length, attivi: 0, ritardo: 0, disdetti: 0, rinnovo7: 0, clienti: 0, inviati: 0, recensiti: 0, somma: 0 };
    for (const e of rows) {
      const s = situazione(e);
      if (s === "attivo" || s === "rinnovo7") k.attivi++;
      if (s === "rinnovo7") k.rinnovo7++;
      if (s === "ritardo") k.ritardo++;
      if (s === "disdetto") k.disdetti++;
      k.clienti += e.clienti;
      k.inviati += e.inviati;
      k.recensiti += e.recensiti;
      k.somma += e.sommaStelle;
    }
    return k;
  }, [rows]);

  // Statistiche per tipo di attività, sugli esercenti filtrati (tranne il filtro tipo,
  // così il confronto tra categorie resta sempre visibile).
  const perTipo = useMemo(() => {
    const base = rows.filter((e) => {
      const q = cerca.trim().toLowerCase();
      if (q && !`${e.nomeAttivita} ${e.email} ${e.whatsapp}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const m = new Map<string, { tipo: string; esercenti: number; attivi: number; clienti: number; inviati: number; recensiti: number; sommaStelle: number }>();
    for (const e of base) {
      const t = e.tipoAttivita || "Non indicato";
      const r = m.get(t) || { tipo: t, esercenti: 0, attivi: 0, clienti: 0, inviati: 0, recensiti: 0, sommaStelle: 0 };
      r.esercenti++;
      const s = situazione(e);
      if (s === "attivo" || s === "rinnovo7") r.attivi++;
      r.clienti += e.clienti;
      r.inviati += e.inviati;
      r.recensiti += e.recensiti;
      r.sommaStelle += e.sommaStelle;
      m.set(t, r);
    }
    const list = Array.from(m.values());
    const v = (r: (typeof list)[number]) => {
      switch (tipoSort) {
        case "recensiti":
          return r.recensiti;
        case "tasso":
          return tasso(r);
        case "media":
          return media(r);
        case "perEsercente":
          return r.esercenti ? r.recensiti / r.esercenti : 0;
        default:
          return r.esercenti;
      }
    };
    return list.sort((a, b) => v(b) - v(a));
  }, [rows, cerca, tipoSort]);

  function ordina(k: SortKey) {
    if (k === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      setSortAsc(k === "nomeAttivita" || k === "tipoAttivita" || k === "dataProssimoRinnovo");
    }
  }

  const thProps = { sortKey, sortAsc, onSort: ordina };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Area admin · Recensioni a 5 Stelle</h1>
            <p className="text-xs text-gray-400">
              {lastUpdated ? `Aggiornato alle ${lastUpdated.toLocaleTimeString("it-IT")} · si aggiorna ogni minuto` : "Caricamento…"}
            </p>
          </div>
          <div className="flex gap-4 items-center">
            <button onClick={() => load(true)} className="text-sm text-gray-300 hover:text-white underline">
              Aggiorna ora
            </button>
            <button onClick={logout} className="text-sm text-gray-300 hover:text-white">
              Esci
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {errore && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">{errore}</div>}

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          <Kpi label="Esercenti" value={kpi.tot} onClick={() => setSit("")} />
          <Kpi label="Attivi" value={kpi.attivi} tone="green" onClick={() => setSit("attivi")} />
          <Kpi label="In ritardo" value={kpi.ritardo} tone={kpi.ritardo ? "red" : undefined} onClick={() => setSit("ritardo")} />
          <Kpi label="Rinnovo ≤ 7 gg" value={kpi.rinnovo7} tone={kpi.rinnovo7 ? "amber" : undefined} onClick={() => setSit("rinnovo7")} />
          <Kpi label="Disdetti" value={kpi.disdetti} onClick={() => setSit("disdetto")} />
          <Kpi label="Clienti caricati" value={kpi.clienti} />
          <Kpi label="Richieste inviate" value={kpi.inviati} />
          <Kpi
            label="Recensioni"
            value={kpi.recensiti}
            sub={kpi.recensiti ? `media ${(kpi.somma / kpi.recensiti).toFixed(1).replace(".", ",")}★ · ${pct(kpi.inviati ? kpi.recensiti / kpi.inviati : -1)} risposta` : undefined}
          />
        </div>

        {/* Per tipo di attività */}
        <div className="bg-white rounded-xl border border-gray-200 mb-6 overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Rendimento per tipo di attività</h2>
              <p className="text-xs text-gray-500">Clicca una riga per filtrare l&apos;elenco esercenti su quel tipo.</p>
            </div>
            <label className="text-xs text-gray-500">
              Ordina per{" "}
              <select value={tipoSort} onChange={(e) => setTipoSort(e.target.value as typeof tipoSort)} className="rounded border border-gray-300 text-xs px-2 py-1 ml-1">
                <option value="esercenti">N. esercenti</option>
                <option value="recensiti">Recensioni totali</option>
                <option value="perEsercente">Recensioni per esercente</option>
                <option value="tasso">Tasso di risposta</option>
                <option value="media">Media stelle</option>
              </select>
            </label>
          </div>
          <table className="w-full text-sm mt-3">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2">Tipo</th>
                <th className="text-right px-3 py-2">Esercenti</th>
                <th className="text-right px-3 py-2">Attivi</th>
                <th className="text-right px-3 py-2">Clienti</th>
                <th className="text-right px-3 py-2">Inviati</th>
                <th className="text-right px-3 py-2">Recensioni</th>
                <th className="text-right px-3 py-2">Rec./esercente</th>
                <th className="text-right px-3 py-2">Risposta</th>
                <th className="text-right px-4 py-2">Media ★</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {perTipo.map((r) => (
                <tr
                  key={r.tipo}
                  onClick={() => setTipo(tipo === r.tipo ? "" : r.tipo)}
                  className={`cursor-pointer hover:bg-gray-50 ${tipo === r.tipo ? "bg-blue-50" : ""}`}
                >
                  <td className="px-4 py-2 font-medium text-gray-900">{r.tipo}</td>
                  <td className="px-3 py-2 text-right">{r.esercenti}</td>
                  <td className="px-3 py-2 text-right">{r.attivi}</td>
                  <td className="px-3 py-2 text-right">{r.clienti}</td>
                  <td className="px-3 py-2 text-right">{r.inviati}</td>
                  <td className="px-3 py-2 text-right">{r.recensiti}</td>
                  <td className="px-3 py-2 text-right">{r.esercenti ? (r.recensiti / r.esercenti).toFixed(1).replace(".", ",") : "—"}</td>
                  <td className="px-3 py-2 text-right">{pct(tasso(r))}</td>
                  <td className="px-4 py-2 text-right">{stelleFmt(media(r))}</td>
                </tr>
              ))}
              {perTipo.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-gray-400">
                    {loading ? "Caricamento…" : "Nessun dato"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Filtri elenco */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
          <div className="grow min-w-[200px]">
            <label className="block text-xs text-gray-500 mb-1">Cerca</label>
            <input
              value={cerca}
              onChange={(e) => setCerca(e.target.value)}
              placeholder="Nome attività, email o numero…"
              className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tipo attività</label>
            <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
              <option value="">Tutti</option>
              {tipi.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Situazione</label>
            <select value={sit} onChange={(e) => setSit(e.target.value)} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
              {FILTRI_SITUAZIONE.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </div>
          {(cerca || tipo || sit) && (
            <button
              onClick={() => {
                setCerca("");
                setTipo("");
                setSit("");
              }}
              className="text-sm text-gray-500 hover:text-gray-900 underline pb-1.5"
            >
              Azzera filtri
            </button>
          )}
          <p className="ml-auto text-sm text-gray-600 pb-1.5">
            <b>{filtrati.length}</b> di {rows.length} esercenti
          </p>
        </div>

        {/* Elenco esercenti */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <Th k="nomeAttivita" {...thProps}>Attività</Th>
                <Th k="tipoAttivita" {...thProps}>Tipo</Th>
                <Th k="situazione" {...thProps}>Situazione</Th>
                <Th k="dataAttivazione" {...thProps}>Attivato</Th>
                <Th k="dataProssimoRinnovo" {...thProps}>Prossimo rinnovo</Th>
                <Th k="clienti" right {...thProps}>Clienti</Th>
                <Th k="inviati" right {...thProps}>Inviati</Th>
                <Th k="recensiti" right {...thProps}>Recens.</Th>
                <Th k="tasso" right {...thProps}>Risposta</Th>
                <Th k="media" right {...thProps}>Media ★</Th>
                <Th k="ultimoCliente" {...thProps}>Ultimo cliente</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-gray-400">
                    Caricamento…
                  </td>
                </tr>
              ) : ordinati.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-8 text-center text-gray-400">
                    Nessun esercente con questi filtri
                  </td>
                </tr>
              ) : (
                ordinati.map((e) => {
                  const s = situazione(e);
                  const badge = SITUAZIONE_BADGE[s];
                  const g = giorniDaOggi(e.dataProssimoRinnovo);
                  const isOpen = aperto === e.email;
                  return (
                    <Fragment key={e.email}>
                      <tr onClick={() => setAperto(isOpen ? null : e.email)} className={`cursor-pointer hover:bg-gray-50 ${isOpen ? "bg-blue-50" : ""}`}>
                        <td className="px-3 py-2">
                          <p className="font-medium text-gray-900">{e.nomeAttivita || "—"}</p>
                          <p className="text-xs text-gray-500">{e.email}</p>
                        </td>
                        <td className="px-3 py-2 text-gray-600">{e.tipoAttivita || "—"}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${badge.cls}`}>{badge.label}</span>
                          {s === "ritardo" && e.dataUltimoFallimento && (
                            <p className="text-[11px] text-red-600 mt-0.5">dal {formatDataIt(e.dataUltimoFallimento)}</p>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDataIt(e.dataAttivazione)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {formatDataIt(e.dataProssimoRinnovo)}
                          {g != null && s !== "disdetto" && (
                            <span className={`text-xs ml-1 ${g < 0 ? "text-red-600" : g <= 7 ? "text-amber-700" : "text-gray-400"}`}>
                              ({g < 0 ? `scaduto da ${-g} gg` : g === 0 ? "oggi" : `tra ${g} gg`})
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right">{e.clienti}</td>
                        <td className="px-3 py-2 text-right">{e.inviati}</td>
                        <td className="px-3 py-2 text-right">{e.recensiti}</td>
                        <td className="px-3 py-2 text-right">{pct(tasso(e))}</td>
                        <td className="px-3 py-2 text-right">{stelleFmt(media(e))}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{e.ultimoCliente ? formatDataIt(e.ultimoCliente) : "—"}</td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={11} className="bg-blue-50/50 px-4 py-4">
                            <DettaglioEsercente e={e} onChanged={() => load(true)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}

function Th({
  k,
  children,
  right,
  sortKey,
  sortAsc,
  onSort,
}: {
  k: SortKey;
  children: React.ReactNode;
  right?: boolean;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className={`px-3 py-2 ${right ? "text-right" : "text-left"} whitespace-nowrap`}>
      <button onClick={() => onSort(k)} className="uppercase hover:text-gray-900">
        {children}
        {sortKey === k ? (sortAsc ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

function Kpi({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: number;
  sub?: string;
  tone?: "green" | "red" | "amber";
  onClick?: () => void;
}) {
  const color = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-gray-900";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`bg-white rounded-xl border border-gray-200 p-3 text-left ${onClick ? "hover:border-gray-400" : ""}`}>
      <p className="text-[11px] text-gray-500 leading-tight">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-500 leading-tight">{sub}</p>}
    </Tag>
  );
}

/** Pannello di dettaglio: dati di contatto, stato Stripe live e azioni di assistenza. */
function DettaglioEsercente({ e, onChanged }: { e: EsercenteAdminRow; onChanged: () => void }) {
  const [info, setInfo] = useState<SubInfo | null>(null);
  const [piano, setPiano] = useState("");
  const [stato, setStato] = useState<"loading" | "ok" | "errore" | "nessuno">(e.haStripe ? "loading" : "nessuno");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!e.haStripe) return;
    let vivo = true;
    fetch(`/api/admin/abbonamento?email=${encodeURIComponent(e.email)}`, { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json();
        if (!vivo) return;
        if (!r.ok) {
          setMsg(d.error || "Errore");
          setStato("errore");
          return;
        }
        setInfo(d.info);
        setPiano(d.piano);
        setStato(d.info ? "ok" : "nessuno");
      })
      .catch(() => vivo && setStato("errore"));
    return () => {
      vivo = false;
    };
  }, [e.email, e.haStripe]);

  async function azione(tipo: "disdici" | "riattiva") {
    const testo =
      tipo === "disdici"
        ? `Disdire l'abbonamento di "${e.nomeAttivita}"?\n\nLa disdetta vale a fine periodo: il servizio resta attivo fino al ${formatDataIt(info?.periodEnd)}, poi non si rinnova. Nessun rimborso, nessun addebito in più.`
        : `Annullare la disdetta di "${e.nomeAttivita}"?\n\nL'abbonamento tornerà a rinnovarsi automaticamente.`;
    if (!window.confirm(testo)) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/abbonamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e.email, azione: tipo }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Operazione non riuscita");
      setInfo(d.info);
      setPiano(d.piano);
      setMsg(tipo === "disdici" ? "Disdetta registrata su Stripe." : "Disdetta annullata: l'abbonamento si rinnoverà.");
      onChanged();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Operazione non riuscita");
    } finally {
      setBusy(false);
    }
  }

  const statoStripe: Record<string, string> = {
    trialing: "In prova gratuita",
    active: "Attivo",
    past_due: "Pagamento in ritardo",
    unpaid: "Non pagato",
    canceled: "Cancellato",
    incomplete: "Incompleto",
    incomplete_expired: "Scaduto (incompleto)",
    paused: "In pausa",
  };
  const vivo = info && ["trialing", "active", "past_due", "unpaid", "incomplete"].includes(info.status);
  const wa = e.whatsapp.replace(/\D/g, "");

  return (
    <div className="grid md:grid-cols-2 gap-4 text-sm">
      <div className="space-y-1">
        <p className="font-semibold text-gray-900">Contatti</p>
        <p>
          Email: <a className="underline" href={`mailto:${e.email}`}>{e.email}</a>
        </p>
        <p>
          WhatsApp:{" "}
          {wa ? (
            <a className="underline" href={`https://wa.me/${wa}`} target="_blank" rel="noopener">
              {e.whatsapp}
            </a>
          ) : (
            "—"
          )}
        </p>
        <p className="text-gray-600">
          Stato nel foglio: <b>{e.stato || "—"}</b> · Pagamento: <b>{e.statoPagamento || "—"}</b>
        </p>
        <p className="text-gray-600">
          Ultimo pagamento: {formatDataIt(e.dataUltimoPagamento)} · Ultimo fallimento: {formatDataIt(e.dataUltimoFallimento)}
        </p>
      </div>
      <div className="space-y-2">
        <p className="font-semibold text-gray-900">Abbonamento su Stripe (in tempo reale)</p>
        {stato === "loading" && <p className="text-gray-500">Lettura da Stripe…</p>}
        {stato === "nessuno" && <p className="text-gray-500">Nessun abbonamento Stripe collegato.</p>}
        {stato === "errore" && <p className="text-red-600">{msg || "Stripe non raggiungibile"}</p>}
        {stato === "ok" && info && (
          <>
            <p>
              <b>{statoStripe[info.status] || info.status}</b>
              {piano && piano !== "—" && <> · {piano}</>}
              {info.amount != null && <> · {info.amount.toFixed(2).replace(".", ",")} €</>}
            </p>
            {info.status === "trialing" && info.trialEnd && <p className="text-gray-600">Prova gratuita fino al {formatDataIt(info.trialEnd)}</p>}
            {info.cancelAtPeriodEnd ? (
              <p className="text-amber-700">Disdetta programmata: attivo fino al {formatDataIt(info.cancelAt || info.periodEnd)}, poi non si rinnova.</p>
            ) : (
              vivo && <p className="text-gray-600">Prossimo rinnovo: {formatDataIt(info.periodEnd)}</p>
            )}
            <div className="flex gap-2 pt-1">
              {vivo && !info.cancelAtPeriodEnd && (
                <button
                  disabled={busy}
                  onClick={() => azione("disdici")}
                  className="border border-red-300 text-red-700 rounded-lg px-3 py-1.5 hover:bg-red-50 disabled:opacity-50"
                >
                  {busy ? "Attendi…" : "Disdici a fine periodo"}
                </button>
              )}
              {vivo && info.cancelAtPeriodEnd && (
                <button
                  disabled={busy}
                  onClick={() => azione("riattiva")}
                  className="border border-green-300 text-green-700 rounded-lg px-3 py-1.5 hover:bg-green-50 disabled:opacity-50"
                >
                  {busy ? "Attendi…" : "Annulla disdetta"}
                </button>
              )}
            </div>
            {msg && <p className="text-gray-700">{msg}</p>}
          </>
        )}
      </div>
    </div>
  );
}
