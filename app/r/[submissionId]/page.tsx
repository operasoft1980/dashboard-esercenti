"use client";

import { useEffect, useState, use } from "react";

type Info = {
  nomeCliente: string;
  nomeAttivitaEsercente: string;
  giaRecensito: boolean;
};

const SOGLIA_STELLE_GOOGLE = 4;

export default function ReviewPage({
  params,
}: {
  params: Promise<{ submissionId: string }>;
}) {
  const { submissionId } = use(params);
  const [info, setInfo] = useState<Info | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [stelle, setStelle] = useState(0);
  const [hoverStelle, setHoverStelle] = useState(0);
  const [commento, setCommento] = useState("");
  const [step, setStep] = useState<"vota" | "commento" | "invio" | "fatto">("vota");
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    fetch(`/api/review/${submissionId}`)
      .then((res) => {
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then((data: Info) => setInfo(data))
      .catch(() => setLoadError(true));
  }, [submissionId]);

  function handleStelleClick(n: number) {
    setStelle(n);
    // Sotto le 4 stelle chiediamo un commento privato prima di inviare;
    // dalla 4a in su si va dritti all'invio (poi redirect a Google).
    setStep(n < SOGLIA_STELLE_GOOGLE ? "commento" : "invio");
    if (n >= SOGLIA_STELLE_GOOGLE) submit(n, "");
  }

  async function submit(stelleScelte: number, commentoScelto: string) {
    setStep("invio");
    setSubmitError("");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, stelle: stelleScelte, commento: commentoScelto }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error || "Qualcosa è andato storto, riprova.");
        setStep(stelleScelte < SOGLIA_STELLE_GOOGLE ? "commento" : "vota");
        return;
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      setStep("fatto");
    } catch {
      setSubmitError("Errore di rete, riprova.");
      setStep(stelleScelte < SOGLIA_STELLE_GOOGLE ? "commento" : "vota");
    }
  }

  if (loadError) {
    return (
      <Shell>
        <p className="text-sm text-gray-600">
          Questo link non è valido o è scaduto.
        </p>
      </Shell>
    );
  }

  if (!info) {
    return (
      <Shell>
        <p className="text-sm text-gray-400">Caricamento…</p>
      </Shell>
    );
  }

  if (info.giaRecensito) {
    return (
      <Shell nomeAttivita={info.nomeAttivitaEsercente}>
        <p className="text-sm text-gray-600">
          Grazie {info.nomeCliente ? `, ${info.nomeCliente}` : ""}! Hai già inviato la tua
          recensione con questo link.
        </p>
      </Shell>
    );
  }

  if (step === "fatto") {
    return (
      <Shell nomeAttivita={info.nomeAttivitaEsercente}>
        <p className="text-2xl mb-2">🙏</p>
        <p className="text-sm text-gray-600">
          Grazie per il tuo feedback! È stato inviato direttamente al titolare, che farà il
          possibile per migliorare.
        </p>
      </Shell>
    );
  }

  return (
    <Shell nomeAttivita={info.nomeAttivitaEsercente}>
      <p className="text-sm text-gray-600 mb-5">
        Ciao {info.nomeCliente || ""}, quante stelle daresti alla tua esperienza?
      </p>

      <div className="flex justify-center gap-1 mb-2" onMouseLeave={() => setHoverStelle(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            aria-label={`${n} stelle`}
            disabled={step === "invio"}
            onMouseEnter={() => setHoverStelle(n)}
            onClick={() => handleStelleClick(n)}
            className="text-4xl leading-none px-0.5 disabled:opacity-50"
          >
            {(hoverStelle || stelle) >= n ? "⭐" : "☆"}
          </button>
        ))}
      </div>

      {step === "commento" && (
        <div className="mt-5 text-left">
          <p className="text-xs text-gray-500 mb-2">
            Ci dispiace che non sia andata benissimo. Raccontaci cosa possiamo migliorare — resterà
            privato, visibile solo al titolare.
          </p>
          <textarea
            value={commento}
            onChange={(e) => setCommento(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-gray-300 text-sm px-3 py-2 mb-3"
            placeholder="Scrivi qui (facoltativo)…"
          />
          {submitError && <p className="text-xs text-red-600 mb-2">{submitError}</p>}
          <button
            onClick={() => submit(stelle, commento)}
            className="w-full bg-gray-900 text-white text-sm rounded-lg py-2.5 font-medium hover:bg-gray-800"
          >
            Invia feedback privato
          </button>
        </div>
      )}

      {step === "invio" && (
        <p className="text-sm text-gray-400 mt-4">Invio in corso…</p>
      )}

      {submitError && step !== "commento" && (
        <p className="text-xs text-red-600 mt-3">{submitError}</p>
      )}
    </Shell>
  );
}

function Shell({
  nomeAttivita,
  children,
}: {
  nomeAttivita?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
        <h1 className="text-lg font-semibold text-gray-900 mb-1">
          {nomeAttivita || "Recensioni a 5 Stelle"}
        </h1>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

