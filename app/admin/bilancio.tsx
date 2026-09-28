"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CATEGORIE_COSTO,
  RICORRENZE,
  type ContoEconomico,
  type Costo,
  type MetricheAbbonamenti,
  type OccorrenzaCosto,
  type Parametri,
  type Ricorrenza,
} from "@/lib/bilancioCalc";
import { formatDataIt } from "@/lib/dates";
import { euro, percento } from "@/lib/format";

type Tipo = "mese" | "trimestre" | "semestre" | "anno" | "inizio" | "personalizzato";

type Risposta = {
  periodo: { da: string; a: string; giorni: number; oggi: string };
  conto: ContoEconomico;
  perMese: { mese: string; ricaviNetti: number; commissioni: number; costi: number; utileAnteImposte: number; utileNetto: number }[];
  perCategoria: Record<string, number>;
  occorrenze: OccorrenzaCosto[];
  costi: Costo[];
  parametri: Parametri;
  abbonamenti: MetricheAbbonamenti;
  creditiInsoluti: number;
  movimenti: number;
};

const ANNO_INIZIO = 2026;
const MESI = ["Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno", "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre"];
const MESI_BREVI = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

function oggiYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function ultimoGiorno(ym: string): string {
  const [y, m] = ym.split("-").map((x) => parseInt(x, 10));
  const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(d).padStart(2, "0")}`;
}

/** Calcola le date Da/A dal tipo di periodo scelto. */
function periodo(tipo: Tipo, anno: number, indice: number, daCustom: string, aCustom: string): { da: string; a: string; nome: string } {
  const y = String(anno);
  const mm = (m: number) => String(m).padStart(2, "0");
  switch (tipo) {
    case "mese":
      return { da: `${y}-${mm(indice)}-01`, a: ultimoGiorno(`${y}-${mm(indice)}`), nome: `${MESI[indice - 1]} ${y}` };
    case "trimestre": {
      const m0 = (indice - 1) * 3 + 1;
      return { da: `${y}-${mm(m0)}-01`, a: ultimoGiorno(`${y}-${mm(m0 + 2)}`), nome: `${indice}° trimestre ${y}` };
    }
    case "semestre": {
      const m0 = indice === 1 ? 1 : 7;
      return { da: `${y}-${mm(m0)}-01`, a: ultimoGiorno(`${y}-${mm(m0 + 5)}`), nome: `${indice}° semestre ${y}` };
    }
    case "anno":
      return { da: `${y}-01-01`, a: `${y}-12-31`, nome: `Anno ${y}` };
    case "inizio":
      return { da: `${ANNO_INIZIO}-01-01`, a: oggiYmd(), nome: "Dall'inizio dell'attività" };
    default:
      return { da: daCustom, a: aCustom, nome: `Dal ${formatDataIt(daCustom)} al ${formatDataIt(aCustom)}` };
  }
}

export default function Bilancio() {
  const oggi = oggiYmd();
  const annoCorrente = new Date().getFullYear();
  const meseCorrente = new Date().getMonth() + 1;

  const [tipo, setTipo] = useState<Tipo>("mese");
  const [anno, setAnno] = useState(annoCorrente);
  const [indice, setIndice] = useState(meseCorrente);
  const [daCustom, setDaCustom] = useState(`${annoCorrente}-01-01`);
  const [aCustom, setACustom] = useState(oggi);

  const [dati, setDati] = useState<Risposta | null>(null);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState("");

  const p = useMemo(() => periodo(tipo, anno, indice, daCustom, aCustom), [tipo, anno, indice, daCustom, aCustom]);
  const periodoValido = /^\d{4}-\d{2}-\d{2}$/.test(p.da) && /^\d{4}-\d{2}-\d{2}$/.test(p.a) && p.da <= p.a;

  const carica = useCallback(async () => {
    if (!periodoValido) return;
    setLoading(true);
    setErrore("");
    try {
      const res = await fetch(`/api/admin/bilancio?da=${p.da}&a=${p.a}`, { cache: "no-store" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Caricamento non riuscito");
      setDati(d);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Caricamento non riuscito");
    } finally {
      setLoading(false);
    }
  }, [p.da, p.a, periodoValido]);

  useEffect(() => {
    carica();
  }, [carica]);

  function cambiaTipo(t: Tipo) {
    setTipo(t);
    if (t === "mese") setIndice(meseCorrente);
    if (t === "trimestre") setIndice(Math.floor((meseCorrente - 1) / 3) + 1);
    if (t === "semestre") setIndice(meseCorrente <= 6 ? 1 : 2);
  }

  const anni = [];
  for (let y = ANNO_INIZIO; y <= annoCorrente + 1; y++) anni.push(y);

  const c = dati?.conto;
  const ab = dati?.abbonamenti;
  const maxMese = Math.max(1, ...(dati?.perMese || []).map((m) => Math.max(m.ricaviNetti, m.costi + m.commissioni)));

  return (
    <main className="max-w-[1500px] mx-auto px-4 py-6">
      {/* Scelta periodo */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end print:hidden">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Periodo</label>
          <select value={tipo} onChange={(e) => cambiaTipo(e.target.value as Tipo)} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
            <option value="mese">Mensile</option>
            <option value="trimestre">Trimestrale</option>
            <option value="semestre">Semestrale</option>
            <option value="anno">Annuale</option>
            <option value="inizio">Dall&apos;inizio</option>
            <option value="personalizzato">Date personalizzate</option>
          </select>
        </div>
        {tipo !== "inizio" && tipo !== "personalizzato" && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Anno</label>
            <select value={anno} onChange={(e) => setAnno(parseInt(e.target.value, 10))} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
              {anni.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}
        {tipo === "mese" && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">Mese</label>
            <select value={indice} onChange={(e) => setIndice(parseInt(e.target.value, 10))} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
              {MESI.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        )}
        {(tipo === "trimestre" || tipo === "semestre") && (
          <div>
            <label className="block text-xs text-gray-500 mb-1">{tipo === "trimestre" ? "Trimestre" : "Semestre"}</label>
            <select value={indice} onChange={(e) => setIndice(parseInt(e.target.value, 10))} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
              {(tipo === "trimestre" ? [1, 2, 3, 4] : [1, 2]).map((n) => (
                <option key={n} value={n}>
                  {n}°{tipo === "trimestre" ? ` (${MESI_BREVI[(n - 1) * 3]}–${MESI_BREVI[(n - 1) * 3 + 2]})` : n === 1 ? " (gen–giu)" : " (lug–dic)"}
                </option>
              ))}
            </select>
          </div>
        )}
        {tipo === "personalizzato" && (
          <>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Dal</label>
              <input type="date" value={daCustom} onChange={(e) => setDaCustom(e.target.value)} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">al</label>
              <input type="date" value={aCustom} onChange={(e) => setACustom(e.target.value)} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
            </div>
          </>
        )}
        <div className="ml-auto flex gap-2">
          <button onClick={carica} className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">
            Aggiorna
          </button>
          <button onClick={() => window.print()} className="text-sm bg-gray-900 text-white rounded-lg px-3 py-1.5 hover:bg-gray-800">
            Stampa / PDF
          </button>
        </div>
      </div>

      <h2 className="text-xl font-semibold text-gray-900 mb-1">Bilancio · {p.nome}</h2>
      <p className="text-xs text-gray-500 mb-4">
        Criterio di cassa: incassi e commissioni reali da Stripe, costi inseriti da te fino a oggi.
        {dati && <> · {dati.movimenti} movimenti Stripe nel periodo</>}
        {loading && " · caricamento…"}
      </p>
      {!periodoValido && <Avviso>La data iniziale deve precedere quella finale.</Avviso>}
      {errore && <Avviso>{errore}</Avviso>}

      {c && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
            <Card label="Ricavi netti" value={euro(c.ricaviNetti)} />
            <Card label="Commissioni Stripe" value={euro(c.commissioni)} />
            <Card label="Costi di gestione" value={euro(c.costi)} />
            <Card label="Utile ante imposte" value={euro(c.utileAnteImposte)} tone={c.utileAnteImposte < 0 ? "red" : "green"} />
            <Card label="Utile netto" value={euro(c.utileNetto)} tone={c.utileNetto < 0 ? "red" : "green"} />
            <Card label="Margine netto" value={percento(c.marginePct)} tone={c.marginePct != null && c.marginePct < 0 ? "red" : undefined} />
          </div>

          <div className="grid lg:grid-cols-3 gap-4 mb-6">
            {/* Conto economico scalare */}
            <Box titolo="Conto economico">
              <table className="w-full text-sm">
                <tbody>
                  <Riga l="Incassi lordi" v={c.ricaviLordi} />
                  <Riga l="− Rimborsi" v={-c.rimborsi} />
                  <Riga l="= Ricavi netti" v={c.ricaviNetti} bold />
                  <Riga l="− Commissioni Stripe" v={-c.commissioni} />
                  <Riga l="= Margine lordo" v={c.margineLordo} bold />
                  <Riga l="− Costi di gestione" v={-c.costi} />
                  <Riga l="= Utile ante imposte" v={c.utileAnteImposte} bold />
                  <Riga l={`− Imposte stimate${dati.parametri.aliquotaImposte ? ` (${String(dati.parametri.aliquotaImposte).replace(".", ",")}%)` : ""}`} v={-c.imposte} />
                  <Riga l="= Utile netto" v={c.utileNetto} bold top />
                </tbody>
              </table>
            </Box>

            {/* Indici */}
            <Box titolo="Indici">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500">
                  <tr>
                    <th></th>
                    <th className="text-right font-normal">Periodo</th>
                    <th className="text-right font-normal">Su base annua</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <Indice l="Margine netto" s="utile netto / ricavi netti" v={c.marginePct} />
                  <Indice l="ROS" s="utile operativo / ricavi netti" v={c.ros} />
                  <Indice l="ROI" s="utile operativo / capitale investito" v={c.roi} annuo={c.roiAnnuo} manca={!dati.parametri.capitaleInvestito} />
                  <Indice l="ROE" s="utile netto / capitale proprio" v={c.roe} annuo={c.roeAnnuo} manca={!dati.parametri.capitaleProprio} />
                </tbody>
              </table>
              <p className="text-[11px] text-gray-500 mt-2">
                &quot;Su base annua&quot; proietta il risultato dei {dati.periodo.giorni} giorni trascorsi su 12 mesi. ROI e ROE
                richiedono i capitali nei parametri qui sotto.
              </p>
            </Box>

            {/* Abbonamenti */}
            {ab && (
              <Box titolo="Abbonamenti">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <Dato l="MRR" v={euro(ab.mrr)} hint="ricavo mensile ricorrente" />
                  <Dato l="ARR" v={euro(ab.arr)} hint="MRR × 12" />
                  <Dato l="Paganti" v={String(ab.attivi)} />
                  <Dato l="Ricavo medio / abbonato" v={euro(ab.arpu)} hint="al mese" />
                  <Dato l="In prova" v={String(ab.inProva)} />
                  <Dato l="In ritardo" v={String(ab.inRitardo)} tone={ab.inRitardo ? "red" : undefined} />
                  <Dato l="Nuovi nel periodo" v={String(ab.nuovi)} tone="green" />
                  <Dato l="Cessati nel periodo" v={String(ab.cessati)} tone={ab.cessati ? "red" : undefined} />
                  <Dato l="Churn" v={percento(ab.churnPct)} hint={`su ${ab.attiviInizioPeriodo} attivi a inizio periodo`} />
                  <Dato l="Crediti da incassare" v={euro(dati.creditiInsoluti)} tone={dati.creditiInsoluti ? "red" : undefined} hint="fatture aperte oggi" />
                </div>
              </Box>
            )}
          </div>

          {/* Andamento mensile */}
          {dati.perMese.length > 0 && (
            <Box titolo="Andamento mese per mese">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left py-1">Mese</th>
                      <th className="text-right">Ricavi netti</th>
                      <th className="text-right">Commissioni</th>
                      <th className="text-right">Costi</th>
                      <th className="text-right">Utile ante imp.</th>
                      <th className="text-left pl-4 w-[35%]">Ricavi / uscite</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {dati.perMese.map((m) => {
                      const [yy, mm] = m.mese.split("-");
                      return (
                        <tr key={m.mese}>
                          <td className="py-1.5 whitespace-nowrap">
                            {MESI[parseInt(mm, 10) - 1]} {yy}
                          </td>
                          <td className="text-right">{euro(m.ricaviNetti)}</td>
                          <td className="text-right text-gray-500">{euro(m.commissioni)}</td>
                          <td className="text-right text-gray-500">{euro(m.costi)}</td>
                          <td className={`text-right font-medium ${m.utileAnteImposte < 0 ? "text-red-600" : "text-green-700"}`}>{euro(m.utileAnteImposte)}</td>
                          <td className="pl-4">
                            <div className="h-2 rounded bg-green-500" style={{ width: `${(m.ricaviNetti / maxMese) * 100}%` }} title={`Ricavi ${euro(m.ricaviNetti)}`} />
                            <div className="h-2 rounded bg-red-400 mt-0.5" style={{ width: `${((m.costi + m.commissioni) / maxMese) * 100}%` }} title={`Uscite ${euro(m.costi + m.commissioni)}`} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="text-[11px] text-gray-500 mt-2">
                  <span className="inline-block w-3 h-2 bg-green-500 rounded mr-1" />
                  ricavi netti
                  <span className="inline-block w-3 h-2 bg-red-400 rounded ml-3 mr-1" />
                  costi + commissioni
                </p>
              </div>
            </Box>
          )}

          <div className="grid lg:grid-cols-3 gap-4 mt-6">
            <Box titolo="Costi del periodo per categoria">
              {Object.keys(dati.perCategoria).length === 0 ? (
                <p className="text-sm text-gray-500">Nessun costo nel periodo.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(dati.perCategoria)
                      .sort((a, b) => b[1] - a[1])
                      .map(([cat, v]) => (
                        <tr key={cat}>
                          <td className="py-1.5">{cat}</td>
                          <td className="text-right">{euro(v)}</td>
                          <td className="text-right text-gray-500 w-14">{c.costi ? percento(v / c.costi, 0) : ""}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </Box>
            <div className="lg:col-span-2">
              <ParametriBox parametri={dati.parametri} onSaved={carica} />
            </div>
          </div>

          <div className="mt-6 print:hidden">
            <CostiBox costi={dati.costi} oggi={dati.periodo.oggi} onChanged={carica} />
          </div>
        </>
      )}
    </main>
  );
}

function Avviso({ children }: { children: React.ReactNode }) {
  return <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">{children}</div>;
}

function Box({ titolo, children }: { titolo: string; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{titolo}</h3>
      {children}
    </section>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-600" : "text-gray-900";
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-xl font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function Riga({ l, v, bold, top }: { l: string; v: number; bold?: boolean; top?: boolean }) {
  return (
    <tr className={top ? "border-t-2 border-gray-300" : bold ? "border-t border-gray-200" : ""}>
      <td className={`py-1 ${bold ? "font-semibold" : "text-gray-600"}`}>{l}</td>
      <td className={`py-1 text-right ${bold ? "font-semibold" : ""} ${v < 0 && bold ? "text-red-600" : ""}`}>{euro(v)}</td>
    </tr>
  );
}

function Indice({ l, s, v, annuo, manca }: { l: string; s: string; v: number | null; annuo?: number | null; manca?: boolean }) {
  return (
    <tr>
      <td className="py-1.5">
        <p className="font-medium">{l}</p>
        <p className="text-[11px] text-gray-500">{s}</p>
      </td>
      <td className={`text-right ${v != null && v < 0 ? "text-red-600" : ""}`}>{manca ? <span className="text-gray-400 text-xs">imposta capitale</span> : percento(v)}</td>
      <td className="text-right text-gray-600">{annuo === undefined ? "" : manca ? "" : percento(annuo)}</td>
    </tr>
  );
}

function Dato({ l, v, hint, tone }: { l: string; v: string; hint?: string; tone?: "green" | "red" }) {
  const color = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-600" : "text-gray-900";
  return (
    <div>
      <p className="text-xs text-gray-500">{l}</p>
      <p className={`font-semibold ${color}`}>{v}</p>
      {hint && <p className="text-[10px] text-gray-400 leading-tight">{hint}</p>}
    </div>
  );
}

function ParametriBox({ parametri, onSaved }: { parametri: Parametri; onSaved: () => void }) {
  const toStr = (n: number | null) => (n == null ? "" : String(n));
  const [cp, setCp] = useState(toStr(parametri.capitaleProprio));
  const [ci, setCi] = useState(toStr(parametri.capitaleInvestito));
  const [al, setAl] = useState(toStr(parametri.aliquotaImposte));
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

  async function salva() {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/parametri", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ capitaleProprio: num(cp), capitaleInvestito: num(ci), aliquotaImposte: num(al) }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Salvataggio non riuscito");
      setMsg("Salvato.");
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Salvataggio non riuscito");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box titolo="Parametri per gli indici">
      <div className="grid sm:grid-cols-3 gap-3">
        <Campo l="Capitale proprio (€)" hint="soldi tuoi messi nell'attività — serve per il ROE" v={cp} set={setCp} />
        <Campo l="Capitale investito (€)" hint="totale investito (tuo + prestiti) — serve per il ROI" v={ci} set={setCi} />
        <Campo l="Aliquota imposte stimata (%)" hint="applicata all'utile per stimare l'utile netto" v={al} set={setAl} />
      </div>
      <div className="flex items-center gap-3 mt-3">
        <button onClick={salva} disabled={busy} className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50">
          {busy ? "Salvo…" : "Salva parametri"}
        </button>
        {msg && <span className="text-sm text-gray-600">{msg}</span>}
      </div>
    </Box>
  );
}

function Campo({ l, hint, v, set }: { l: string; hint: string; v: string; set: (s: string) => void }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 mb-1">{l}</span>
      <input inputMode="decimal" value={v} onChange={(e) => set(e.target.value)} className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
      <span className="block text-[10px] text-gray-400 mt-0.5 leading-tight">{hint}</span>
    </label>
  );
}

function CostiBox({ costi, oggi, onChanged }: { costi: Costo[]; oggi: string; onChanged: () => void }) {
  const [data, setData] = useState(oggi);
  const [descrizione, setDescrizione] = useState("");
  const [categoria, setCategoria] = useState<string>(CATEGORIE_COSTO[0]);
  const [importo, setImporto] = useState("");
  const [ricorrenza, setRicorrenza] = useState<Ricorrenza>("Mensile");
  const [dataFine, setDataFine] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function aggiungi(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/costi", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, descrizione, categoria, importo: Number(importo.replace(",", ".")), ricorrenza, dataFine: ricorrenza === "Una tantum" ? "" : dataFine }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Salvataggio non riuscito");
      setDescrizione("");
      setImporto("");
      setDataFine("");
      setMsg("Costo aggiunto.");
      onChanged();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Salvataggio non riuscito");
    } finally {
      setBusy(false);
    }
  }

  async function chiudi(c: Costo) {
    if (!window.confirm(`Interrompere "${c.descrizione}" da oggi?\n\nI mesi passati restano nel bilancio, da domani non viene più conteggiato.`)) return;
    await fetch("/api/admin/costi", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: c.id, dataFine: oggi }),
    });
    onChanged();
  }

  async function elimina(c: Costo) {
    if (!window.confirm(`Eliminare "${c.descrizione}"?\n\nSparisce da tutti i bilanci, anche passati. Se è un costo che hai smesso di pagare, usa invece "Interrompi".`)) return;
    await fetch(`/api/admin/costi?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    onChanged();
  }

  const ricorrenti = costi.filter((c) => c.ricorrenza !== "Una tantum" && (!c.dataFine || c.dataFine >= oggi));
  const mensileRicorrente = ricorrenti.reduce(
    (t, c) => t + c.importo / (c.ricorrenza === "Mensile" ? 1 : c.ricorrenza === "Trimestrale" ? 3 : 12),
    0
  );

  return (
    <Box titolo="Costi di gestione">
      <form onSubmit={aggiungi} className="grid sm:grid-cols-2 lg:grid-cols-7 gap-3 items-end mb-4">
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">{ricorrenza === "Una tantum" ? "Data" : "Dal"}</span>
          <input type="date" required value={data} onChange={(e) => setData(e.target.value)} className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
        </label>
        <label className="block lg:col-span-2">
          <span className="block text-xs text-gray-500 mb-1">Descrizione</span>
          <input required value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="Es. abbonamento Make" className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Categoria</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5">
            {CATEGORIE_COSTO.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Importo (€)</span>
          <input required inputMode="decimal" value={importo} onChange={(e) => setImporto(e.target.value)} placeholder="0,00" className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
        </label>
        <label className="block">
          <span className="block text-xs text-gray-500 mb-1">Ricorrenza</span>
          <select value={ricorrenza} onChange={(e) => setRicorrenza(e.target.value as Ricorrenza)} className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5">
            {RICORRENZE.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={busy} className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2 hover:bg-gray-800 disabled:opacity-50">
          {busy ? "Salvo…" : "+ Aggiungi costo"}
        </button>
        {ricorrenza !== "Una tantum" && (
          <label className="block sm:col-span-2 lg:col-span-2">
            <span className="block text-xs text-gray-500 mb-1">Fino al (facoltativo)</span>
            <input type="date" value={dataFine} onChange={(e) => setDataFine(e.target.value)} className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
          </label>
        )}
      </form>
      {msg && <p className="text-sm text-gray-600 mb-3">{msg}</p>}

      <p className="text-xs text-gray-500 mb-2">
        {costi.length} costi registrati · costi fissi ricorrenti attivi: <b>{euro(mensileRicorrente)}</b> al mese. I costi ricorrenti
        si ripetono alla stessa data ogni mese/trimestre/anno.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-500 uppercase bg-gray-50">
            <tr>
              <th className="text-left px-2 py-1.5">Dal / data</th>
              <th className="text-left px-2">Descrizione</th>
              <th className="text-left px-2">Categoria</th>
              <th className="text-left px-2">Ricorrenza</th>
              <th className="text-right px-2">Importo</th>
              <th className="text-left px-2">Fino al</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {costi.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center text-gray-400 py-4">
                  Nessun costo inserito: aggiungi i costi fissi (Make, Vercel, WhatsApp, dominio…) per vedere l&apos;utile reale.
                </td>
              </tr>
            )}
            {[...costi]
              .sort((a, b) => (a.data < b.data ? 1 : -1))
              .map((k) => {
                const concluso = !!k.dataFine && k.dataFine < oggi;
                return (
                  <tr key={k.id} className={concluso ? "text-gray-400" : ""}>
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatDataIt(k.data)}</td>
                    <td className="px-2">{k.descrizione}</td>
                    <td className="px-2">{k.categoria}</td>
                    <td className="px-2">{k.ricorrenza}</td>
                    <td className="px-2 text-right whitespace-nowrap">{euro(k.importo)}</td>
                    <td className="px-2 whitespace-nowrap">{k.ricorrenza === "Una tantum" ? "" : k.dataFine ? formatDataIt(k.dataFine) : "in corso"}</td>
                    <td className="px-2 text-right whitespace-nowrap">
                      {k.ricorrenza !== "Una tantum" && !k.dataFine && (
                        <button onClick={() => chiudi(k)} className="text-xs text-gray-500 hover:text-gray-900 underline mr-3">
                          Interrompi
                        </button>
                      )}
                      <button onClick={() => elimina(k)} className="text-xs text-red-500 hover:text-red-700 underline">
                        Elimina
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </Box>
  );
}
