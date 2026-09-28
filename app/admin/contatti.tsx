"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Campagna, Contatto, StatoContatto } from "@/lib/contatti";
import { componiHtml, personalizzaOggetto } from "@/lib/emailProspezione";
import { formatDataIt } from "@/lib/dates";

const BADGE: Record<StatoContatto, string> = {
  Nuovo: "bg-gray-100 text-gray-700",
  Inviato: "bg-blue-50 text-blue-700",
  Consegnata: "bg-blue-100 text-blue-800",
  Aperta: "bg-amber-100 text-amber-800",
  Cliccata: "bg-green-100 text-green-800",
  Rimbalzata: "bg-red-100 text-red-700",
  Spam: "bg-red-200 text-red-800",
  Disiscritto: "bg-gray-200 text-gray-700",
  Errore: "bg-red-50 text-red-700",
};
const STATI: StatoContatto[] = ["Nuovo", "Inviato", "Consegnata", "Aperta", "Cliccata", "Rimbalzata", "Spam", "Disiscritto", "Errore"];

type SortKey = "nome" | "tipo" | "citta" | "voto" | "recensioni" | "stato" | "inviato";

export default function ContattiAdmin() {
  const [contatti, setContatti] = useState<Contatto[]>([]);
  const [inviatiOggi, setInviatiOggi] = useState(0);
  const [limite, setLimite] = useState(80);
  const [brevo, setBrevo] = useState(true);
  const [loading, setLoading] = useState(true);
  const [errore, setErrore] = useState("");
  const [msg, setMsg] = useState("");

  const [cerca, setCerca] = useState("");
  const [tipo, setTipo] = useState("");
  const [citta, setCitta] = useState("");
  const [stato, setStato] = useState("");
  const [maxRecensioni, setMaxRecensioni] = useState("");
  const [maxVoto, setMaxVoto] = useState("");
  const [nascondiBloccati, setNascondiBloccati] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("recensioni");
  const [sortAsc, setSortAsc] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pagina, setPagina] = useState(0);
  const PER_PAGINA = 100;

  const [mostraModello, setMostraModello] = useState(false);
  const [invio, setInvio] = useState<null | { fase: "conferma" | "invio" | "fatto"; risultato?: RisultatoInvio }>(null);
  const [importando, setImportando] = useState("");
  const [sincronizzo, setSincronizzo] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const carica = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/contatti", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Caricamento non riuscito");
      setContatti(d.contatti || []);
      setInviatiOggi(d.inviatiOggi || 0);
      setLimite(d.limiteGiornaliero || 80);
      setBrevo(!!d.brevo);
      setErrore("");
    } catch (e) {
      setErrore(e instanceof Error ? e.message : "Caricamento non riuscito");
    } finally {
      setLoading(false);
    }
  }, []);

  const sincronizzaEsiti = useCallback(async (silenzioso = false) => {
    setSincronizzo(true);
    try {
      const r = await fetch("/api/admin/contatti/esiti", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      if (!silenzioso) setMsg(`Esiti aggiornati da Brevo: ${d.aggiornati} contatti cambiati.`);
      await carica();
    } catch (e) {
      if (!silenzioso) setMsg(e instanceof Error ? e.message : "Aggiornamento esiti non riuscito");
    } finally {
      setSincronizzo(false);
    }
  }, [carica]);

  useEffect(() => {
    carica();
  }, [carica]);

  // Esiti aggiornati da soli ogni 5 minuti mentre la scheda è aperta.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible" && contatti.some((c) => c.messageId)) sincronizzaEsiti(true);
    }, 5 * 60_000);
    return () => window.clearInterval(id);
  }, [sincronizzaEsiti, contatti]);

  async function importa(files: FileList | null) {
    if (!files?.length) return;
    const righe: string[] = [];
    for (const f of Array.from(files)) {
      setImportando(`Importo ${f.name}…`);
      const fd = new FormData();
      fd.append("file", f);
      try {
        const r = await fetch("/api/admin/contatti", { method: "POST", body: fd });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        const s = d.scarti;
        righe.push(
          `${f.name}: ${d.importati} nuovi contatti (scartati: ${s.nonValide} email non valide, ${s.stessaAttivita} doppioni della stessa attività, ${s.giaPresenti} già presenti o già clienti, ${s.esclusi} enti pubblici/chiusi, ${s.senzaEmail} senza email)`
        );
      } catch (e) {
        righe.push(`${f.name}: ${e instanceof Error ? e.message : "errore"}`);
      }
    }
    setImportando("");
    setMsg(righe.join("\n"));
    if (fileRef.current) fileRef.current.value = "";
    carica();
  }

  const tipi = useMemo(() => Array.from(new Set(contatti.map((c) => c.tipo).filter(Boolean))).sort(), [contatti]);
  const citta_ = useMemo(() => {
    const m = new Map<string, number>();
    contatti.forEach((c) => c.citta && m.set(c.citta, (m.get(c.citta) || 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  }, [contatti]);

  const filtrati = useMemo(() => {
    const q = cerca.trim().toLowerCase();
    const maxR = maxRecensioni === "" ? null : Number(maxRecensioni);
    const maxV = maxVoto === "" ? null : Number(maxVoto.replace(",", "."));
    return contatti.filter((c) => {
      if (nascondiBloccati && c.bloccato) return false;
      if (tipo && c.tipo !== tipo) return false;
      if (citta && c.citta !== citta) return false;
      if (stato && c.stato !== stato) return false;
      if (maxR != null && (c.recensioni ?? 0) > maxR) return false;
      if (maxV != null && (c.voto ?? 0) > maxV) return false;
      if (q && !`${c.nome} ${c.email} ${c.citta}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [contatti, cerca, tipo, citta, stato, maxRecensioni, maxVoto, nascondiBloccati]);

  const ordinati = useMemo(() => {
    const v = (c: Contatto): string | number => {
      switch (sortKey) {
        case "voto":
          return c.voto ?? -1;
        case "recensioni":
          return c.recensioni ?? -1;
        case "stato":
          return STATI.indexOf(c.stato);
        default:
          return (c[sortKey] || "").toString().toLowerCase();
      }
    };
    return [...filtrati].sort((a, b) => {
      const x = v(a), y = v(b);
      const cmp = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "it");
      return sortAsc ? cmp : -cmp;
    });
  }, [filtrati, sortKey, sortAsc]);

  const pagine = Math.max(1, Math.ceil(ordinati.length / PER_PAGINA));
  const visibili = ordinati.slice(pagina * PER_PAGINA, (pagina + 1) * PER_PAGINA);
  const inviabili = (c: Contatto) => !c.bloccato && (c.stato === "Nuovo" || c.stato === "Errore");
  const selezionati = contatti.filter((c) => sel.has(c.id));
  const selInviabili = selezionati.filter(inviabili);
  const restantiOggi = Math.max(0, limite - inviatiOggi);

  const kpi = useMemo(() => {
    const k: Record<string, number> = { totale: contatti.length, inviati: 0 };
    STATI.forEach((s) => (k[s] = 0));
    for (const c of contatti) {
      k[c.stato]++;
      if (c.messageId) k.inviati++;
    }
    return k;
  }, [contatti]);

  function toggle(id: string) {
    setSel((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function selezionaPagina() {
    const ids = visibili.filter(inviabili).map((c) => c.id);
    const tutti = ids.every((id) => sel.has(id));
    setSel((p) => {
      const n = new Set(p);
      ids.forEach((id) => (tutti ? n.delete(id) : n.add(id)));
      return n;
    });
  }
  function selezionaPrimi(n: number) {
    setSel(new Set(ordinati.filter(inviabili).slice(0, n).map((c) => c.id)));
  }
  function ordina(k: SortKey) {
    if (k === sortKey) setSortAsc(!sortAsc);
    else {
      setSortKey(k);
      setSortAsc(k !== "inviato");
    }
  }

  async function blocca(bloccato: boolean) {
    if (!selezionati.length) return;
    if (bloccato && !window.confirm(`Escludere ${selezionati.length} contatti? Non riceveranno mai email.`)) return;
    await fetch("/api/admin/contatti", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: selezionati.map((c) => c.id), bloccato }),
    });
    setSel(new Set());
    carica();
  }

  async function confermaInvio() {
    setInvio({ fase: "invio" });
    let totale: RisultatoInvio = { inviati: 0, errori: 0, saltati: 0, rimandati: 0, esiti: [] };
    let ids = selInviabili.map((c) => c.id);
    // lotti da 40 (limite di durata della singola richiesta)
    while (ids.length) {
      const lotto = ids.slice(0, 40);
      ids = ids.slice(40);
      const r = await fetch("/api/admin/contatti/invia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: lotto }),
      });
      const d = await r.json();
      if (!r.ok) {
        totale = { ...totale, errore: d.error || "Invio non riuscito" };
        break;
      }
      totale = {
        inviati: totale.inviati + d.inviati,
        errori: totale.errori + d.errori,
        saltati: totale.saltati + d.saltati,
        rimandati: totale.rimandati + d.rimandati + (d.limiteRestante === 0 ? ids.length : 0),
        esiti: [...totale.esiti, ...d.esiti],
      };
      if (d.limiteRestante === 0 || d.errori > 0) break;
    }
    setInvio({ fase: "fatto", risultato: totale });
    setSel(new Set());
    carica();
  }

  return (
    <main className="max-w-[1500px] mx-auto px-4 py-6">
      {errore && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-4 text-sm">{errore}</div>}
      {!brevo && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 mb-4 text-sm">
          Manca la chiave Brevo (variabile <b>BREVO_API_KEY</b> su Vercel): puoi importare e preparare i contatti, ma non inviare.
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-10 gap-3 mb-4">
        <K l="Contatti" v={kpi.totale} onClick={() => setStato("")} />
        <K l="Da contattare" v={kpi.Nuovo} onClick={() => setStato("Nuovo")} />
        <K l="Inviate" v={kpi.inviati} />
        <K l="Consegnate" v={kpi.Consegnata + kpi.Aperta + kpi.Cliccata} onClick={() => setStato("Consegnata")} />
        <K l="Aperte" v={kpi.Aperta + kpi.Cliccata} tone="amber" onClick={() => setStato("Aperta")} />
        <K l="Cliccate" v={kpi.Cliccata} tone="green" onClick={() => setStato("Cliccata")} />
        <K l="Rimbalzate" v={kpi.Rimbalzata} tone="red" onClick={() => setStato("Rimbalzata")} />
        <K l="Spam" v={kpi.Spam} tone="red" onClick={() => setStato("Spam")} />
        <K l="Disiscritti" v={kpi.Disiscritto} onClick={() => setStato("Disiscritto")} />
        <K l={`Invii oggi (max ${limite})`} v={inviatiOggi} tone={restantiOggi === 0 ? "red" : undefined} />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-center">
        <label className="text-sm bg-gray-900 text-white rounded-lg px-4 py-2 cursor-pointer hover:bg-gray-800">
          {importando || "Importa file Outscraper (.xlsx)"}
          <input ref={fileRef} type="file" accept=".xlsx" multiple className="hidden" disabled={!!importando} onChange={(e) => importa(e.target.files)} />
        </label>
        <button onClick={() => setMostraModello(true)} className="text-sm border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-50">
          ✉️ Modello email
        </button>
        <button onClick={() => sincronizzaEsiti()} disabled={sincronizzo || !brevo} className="text-sm border border-gray-300 rounded-lg px-4 py-2 hover:bg-gray-50 disabled:opacity-50">
          {sincronizzo ? "Aggiorno…" : "Aggiorna esiti da Brevo"}
        </button>
        <p className="text-xs text-gray-500 ml-auto max-w-md">
          Importando si scartano email non valide, doppioni, enti pubblici ed esercenti già clienti. A ogni contatto si scrive
          una sola volta; chi si disiscrive, rimbalza o segnala spam viene escluso per sempre.
        </p>
      </div>
      {msg && (
        <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-xl px-4 py-3 mb-4 text-sm whitespace-pre-line relative">
          {msg}
          <button onClick={() => setMsg("")} className="absolute top-2 right-3 text-blue-400 hover:text-blue-700">✕</button>
        </div>
      )}

      {/* Filtri */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3 items-end">
        <F l="Cerca" grow>
          <input value={cerca} onChange={(e) => { setCerca(e.target.value); setPagina(0); }} placeholder="Nome, email, città…" className="w-full rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
        </F>
        <F l="Tipo">
          <select value={tipo} onChange={(e) => { setTipo(e.target.value); setPagina(0); }} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
            <option value="">Tutti</option>
            {tipi.map((t) => <option key={t}>{t}</option>)}
          </select>
        </F>
        <F l="Città">
          <select value={citta} onChange={(e) => { setCitta(e.target.value); setPagina(0); }} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5 max-w-[180px]">
            <option value="">Tutte</option>
            {citta_.map((t) => <option key={t}>{t}</option>)}
          </select>
        </F>
        <F l="Stato">
          <select value={stato} onChange={(e) => { setStato(e.target.value); setPagina(0); }} className="rounded-lg border border-gray-300 text-sm px-3 py-1.5">
            <option value="">Tutti</option>
            {STATI.map((s) => <option key={s}>{s}</option>)}
          </select>
        </F>
        <F l="Recensioni fino a">
          <input inputMode="numeric" value={maxRecensioni} onChange={(e) => { setMaxRecensioni(e.target.value); setPagina(0); }} placeholder="es. 50" className="w-24 rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
        </F>
        <F l="Voto fino a">
          <input inputMode="decimal" value={maxVoto} onChange={(e) => { setMaxVoto(e.target.value); setPagina(0); }} placeholder="es. 4,3" className="w-20 rounded-lg border border-gray-300 text-sm px-3 py-1.5" />
        </F>
        <label className="text-sm text-gray-600 flex items-center gap-1.5 pb-1.5">
          <input type="checkbox" checked={nascondiBloccati} onChange={(e) => setNascondiBloccati(e.target.checked)} /> nascondi esclusi
        </label>
        <p className="ml-auto text-sm text-gray-600 pb-1.5">
          <b>{filtrati.length}</b> di {contatti.length}
        </p>
      </div>

      {/* Barra azioni */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-4 flex flex-wrap gap-2 items-center text-sm">
        <span className="text-gray-600">Seleziona:</span>
        <button onClick={selezionaPagina} className="underline text-gray-700">pagina</button>
        {[10, 25, 50].map((n) => (
          <button key={n} onClick={() => selezionaPrimi(n)} className="underline text-gray-700">primi {n} da contattare</button>
        ))}
        {sel.size > 0 && <button onClick={() => setSel(new Set())} className="underline text-gray-500">nessuno</button>}
        <span className="ml-auto text-gray-700">
          <b>{sel.size}</b> selezionati · <b>{selInviabili.length}</b> contattabili · oggi ne puoi inviare ancora <b>{restantiOggi}</b>
        </span>
        <button onClick={() => blocca(true)} disabled={!sel.size} className="border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40">Escludi</button>
        <button onClick={() => blocca(false)} disabled={!sel.size} className="border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-40">Riammetti</button>
        <button
          onClick={() => setInvio({ fase: "conferma" })}
          disabled={!selInviabili.length || !brevo || restantiOggi === 0}
          className="bg-green-600 text-white rounded-lg px-4 py-1.5 font-semibold hover:bg-green-700 disabled:bg-gray-300"
        >
          Invia email ({Math.min(selInviabili.length, restantiOggi)})
        </button>
      </div>

      {/* Tabella */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="px-3 py-2 w-8"></th>
              <Th k="nome" s={sortKey} a={sortAsc} o={ordina}>Attività</Th>
              <Th k="tipo" s={sortKey} a={sortAsc} o={ordina}>Tipo</Th>
              <Th k="citta" s={sortKey} a={sortAsc} o={ordina}>Città</Th>
              <Th k="voto" s={sortKey} a={sortAsc} o={ordina} right>Voto</Th>
              <Th k="recensioni" s={sortKey} a={sortAsc} o={ordina} right>Recens.</Th>
              <th className="px-3 py-2 text-left">Email</th>
              <Th k="stato" s={sortKey} a={sortAsc} o={ordina}>Stato</Th>
              <Th k="inviato" s={sortKey} a={sortAsc} o={ordina}>Inviata</Th>
              <th className="px-3 py-2 text-left">Ultimo esito</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">Caricamento…</td></tr>
            ) : visibili.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-400">{contatti.length ? "Nessun contatto con questi filtri" : "Nessun contatto: importa un file Outscraper"}</td></tr>
            ) : (
              visibili.map((c) => (
                <tr key={c.id} className={`${c.bloccato ? "opacity-50" : ""} ${sel.has(c.id) ? "bg-blue-50" : ""}`}>
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} />
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{c.nome}</p>
                    {c.linkMaps && <a href={c.linkMaps} target="_blank" rel="noopener" className="text-xs text-blue-600 underline">Google Maps</a>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{c.tipo}</td>
                  <td className="px-3 py-2 text-gray-600">{c.citta}</td>
                  <td className="px-3 py-2 text-right">{c.voto ? c.voto.toFixed(1).replace(".", ",") : "—"}</td>
                  <td className="px-3 py-2 text-right">{c.recensioni ?? "—"}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {c.email}
                    {c.validazione === "UNKNOWN" && <span className="text-[10px] text-amber-700 ml-1" title="Indirizzo non verificato da Outscraper">(da verificare)</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${BADGE[c.stato]}`}>{c.stato}</span>
                    {c.bloccato && c.stato === "Nuovo" && <span className="text-[10px] text-gray-500 ml-1">escluso</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{c.inviato ? formatDataIt(c.inviato, true) : "—"}</td>
                  <td className="px-3 py-2 text-gray-600 text-xs">
                    {c.ultimoEvento || "—"}
                    {(c.aperture > 0 || c.clic > 0) && <span className="block text-gray-400">{c.aperture} aperture · {c.clic} clic</span>}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagine > 1 && (
        <div className="flex items-center justify-center gap-3 mt-3 text-sm">
          <button disabled={pagina === 0} onClick={() => setPagina(pagina - 1)} className="underline disabled:opacity-30">← precedente</button>
          <span>Pagina {pagina + 1} di {pagine}</span>
          <button disabled={pagina >= pagine - 1} onClick={() => setPagina(pagina + 1)} className="underline disabled:opacity-30">successiva →</button>
        </div>
      )}
      <p className="text-xs text-gray-500 mt-3">
        &quot;Aperta&quot; è indicativo: alcuni programmi di posta aprono le immagini da soli. Il dato affidabile è &quot;Cliccata&quot;.
        Le risposte arrivano nella casella assistenza@recensionia5stelle.it. Non è possibile sapere se un&apos;email viene cestinata senza aprirla.
      </p>

      {mostraModello && <ModelloEmail esempio={selezionati[0] || ordinati[0] || null} onClose={() => { setMostraModello(false); carica(); }} />}

      {invio && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-lg w-full p-5 max-h-[85vh] overflow-y-auto">
            {invio.fase === "conferma" && (
              <>
                <h2 className="text-base font-semibold mb-2">Inviare le email?</h2>
                <p className="text-sm text-gray-600 mb-3">
                  Stai per inviare <b>{Math.min(selInviabili.length, restantiOggi)}</b> email da <b>info@recensionia5stelle.it</b>
                  {selInviabili.length > restantiOggi && <> (le altre {selInviabili.length - restantiOggi} restano per domani: limite giornaliero)</>}.
                  Le risposte arriveranno ad assistenza@recensionia5stelle.it. Ogni contatto riceve una sola email.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setInvio(null)} className="text-sm text-gray-500 px-3 py-2">Annulla</button>
                  <button onClick={confermaInvio} className="bg-green-600 text-white text-sm rounded-lg px-4 py-2 hover:bg-green-700">Conferma e invia</button>
                </div>
              </>
            )}
            {invio.fase === "invio" && <p className="py-8 text-center text-sm text-gray-500">Invio in corso, una email alla volta… non chiudere la pagina.</p>}
            {invio.fase === "fatto" && invio.risultato && (
              <>
                <h2 className="text-base font-semibold mb-2">Invio completato</h2>
                {invio.risultato.errore && <p className="text-sm text-red-600 mb-2">{invio.risultato.errore}</p>}
                <p className="text-sm text-gray-700 mb-3">
                  Inviate: <b>{invio.risultato.inviati}</b> · errori: <b>{invio.risultato.errori}</b>
                  {invio.risultato.saltati > 0 && <> · saltati (già contattati o esclusi): {invio.risultato.saltati}</>}
                  {invio.risultato.rimandati > 0 && <> · rimandati a domani: {invio.risultato.rimandati}</>}
                </p>
                {invio.risultato.esiti.some((e) => !e.ok) && (
                  <ul className="text-xs text-red-700 mb-3 list-disc pl-4">
                    {invio.risultato.esiti.filter((e) => !e.ok).map((e) => <li key={e.id}>{e.nome} ({e.email}): {e.errore}</li>)}
                  </ul>
                )}
                <p className="text-xs text-gray-500 mb-3">Consegne, aperture e clic compaiono nei minuti successivi: usa &quot;Aggiorna esiti da Brevo&quot;.</p>
                <div className="flex justify-end"><button onClick={() => setInvio(null)} className="bg-gray-900 text-white text-sm rounded-lg px-4 py-2">Chiudi</button></div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

type RisultatoInvio = {
  inviati: number;
  errori: number;
  saltati: number;
  rimandati: number;
  esiti: { id: string; nome: string; email: string; ok: boolean; errore?: string }[];
  errore?: string;
};

function K({ l, v, tone, onClick }: { l: string; v: number; tone?: "green" | "red" | "amber"; onClick?: () => void }) {
  const color = tone === "green" ? "text-green-700" : tone === "red" ? "text-red-600" : tone === "amber" ? "text-amber-700" : "text-gray-900";
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`bg-white rounded-xl border border-gray-200 p-3 text-left ${onClick ? "hover:border-gray-400" : ""}`}>
      <p className="text-[11px] text-gray-500 leading-tight">{l}</p>
      <p className={`text-xl font-semibold ${color}`}>{v}</p>
    </Tag>
  );
}

function F({ l, children, grow }: { l: string; children: React.ReactNode; grow?: boolean }) {
  return (
    <div className={grow ? "grow min-w-[180px]" : ""}>
      <label className="block text-xs text-gray-500 mb-1">{l}</label>
      {children}
    </div>
  );
}

function Th({ k, s, a, o, children, right }: { k: SortKey; s: SortKey; a: boolean; o: (k: SortKey) => void; children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-3 py-2 ${right ? "text-right" : "text-left"} whitespace-nowrap`}>
      <button onClick={() => o(k)} className="uppercase hover:text-gray-900">
        {children}
        {s === k ? (a ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

function ModelloEmail({ esempio, onClose }: { esempio: Contatto | null; onClose: () => void }) {
  const [c, setC] = useState<Campagna | null>(null);
  const [predefinita, setPredefinita] = useState<Campagna | null>(null);
  const [mittente, setMittente] = useState("");
  const [risposta, setRisposta] = useState("");
  const [prova, setProva] = useState("assistenza@recensionia5stelle.it");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/admin/campagna", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setC(d.campagna);
        setPredefinita(d.predefinita);
        setMittente(d.mittente);
        setRisposta(d.risposta);
      });
  }, []);

  const dati = useMemo(() => esempio || { nome: "Bar Esempio", citta: "Cagliari", tipo: "Bar", voto: 4.3, recensioni: 57 }, [esempio]);
  const html = useMemo(() => (c ? componiHtml(c.corpo, dati, "#") : ""), [c, dati]);

  async function salva(): Promise<boolean> {
    if (!c) return false;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/admin/campagna", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMsg("Modello salvato.");
      return true;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Salvataggio non riuscito");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function inviaProva() {
    if (!(await salva())) return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/contatti/invia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prova, id: esempio?.id }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMsg(`Email di prova inviata a ${d.prova}. Controlla anche la cartella spam.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Invio di prova non riuscito");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl max-w-6xl w-full p-5 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-semibold">Modello email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        {!c ? (
          <p className="text-sm text-gray-500">Caricamento…</p>
        ) : (
          <div className="grid lg:grid-cols-2 gap-5">
            <div className="space-y-3 text-sm">
              <p className="text-xs text-gray-500">
                Mittente <b>{mittente}</b> · risposte a <b>{risposta}</b>. Segnaposti: {"{{nome}} {{citta}} {{tipo}} {{voto}} {{recensioni}}"}.
                Una riga vuota separa i paragrafi; un paragrafo con un dato mancante (es. attività senza voto) viene tolto da solo.
                Pulsante, dati aziendali e link di disiscrizione vengono aggiunti in automatico.
              </p>
              <label className="block">
                <span className="text-xs text-gray-500">Nome mittente</span>
                <input value={c.nomeMittente} onChange={(e) => setC({ ...c, nomeMittente: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Oggetto</span>
                <input value={c.oggetto} onChange={(e) => setC({ ...c, oggetto: e.target.value })} className="w-full rounded-lg border border-gray-300 px-3 py-1.5" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Testo</span>
                <textarea value={c.corpo} onChange={(e) => setC({ ...c, corpo: e.target.value })} rows={18} className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-[13px]" />
              </label>
              <label className="block">
                <span className="text-xs text-gray-500">Limite di invii al giorno (Brevo gratuito: 300 in tutto, comprese le email ai clienti)</span>
                <input inputMode="numeric" value={c.limiteGiornaliero} onChange={(e) => setC({ ...c, limiteGiornaliero: Number(e.target.value) || 0 })} className="w-28 rounded-lg border border-gray-300 px-3 py-1.5" />
              </label>
              <div className="flex flex-wrap gap-2 items-center">
                <button onClick={salva} disabled={busy} className="bg-gray-900 text-white rounded-lg px-4 py-2 disabled:opacity-50">Salva modello</button>
                {predefinita && (
                  <button onClick={() => setC({ ...predefinita, limiteGiornaliero: c.limiteGiornaliero })} className="border border-gray-300 rounded-lg px-3 py-2">
                    Ripristina testo iniziale
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2 items-center border-t border-gray-100 pt-3">
                <input value={prova} onChange={(e) => setProva(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-1.5 grow" />
                <button onClick={inviaProva} disabled={busy} className="border border-green-600 text-green-700 rounded-lg px-3 py-2 disabled:opacity-50">Invia una prova</button>
              </div>
              {msg && <p className="text-sm text-gray-700">{msg}</p>}
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">
                Anteprima con i dati di: <b>{dati.nome}</b>
              </p>
              <p className="text-sm mb-2"><b>Oggetto:</b> {personalizzaOggetto(c.oggetto, dati)}</p>
              <iframe title="Anteprima email" srcDoc={html} className="w-full h-[640px] border border-gray-200 rounded-lg" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
