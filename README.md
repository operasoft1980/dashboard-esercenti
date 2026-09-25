# Dashboard Esercenti — Recensioni a 5 Stelle

App web che permette a ogni esercente abbonato di accedere con email + codice
personale e vedere/filtrare/scaricare l'elenco dei propri clienti e lo stato
di invio delle richieste di recensione.

Legge i dati direttamente dai Google Sheet già usati da Make — nessun nuovo
database da mantenere.

## Guida al deploy (nessun costo mensile)

### 1. Crea il Service Account Google

1. Vai su https://console.cloud.google.com/ (usa lo stesso account Google del
   Database Centrale).
2. Crea un nuovo progetto (o usane uno esistente).
3. Menu ☰ → *API e servizi* → *Libreria* → cerca "Google Sheets API" → **Abilita**.
4. Menu ☰ → *API e servizi* → *Credenziali* → *Crea credenziali* →
   *Account di servizio*. Dagli un nome (es. "dashboard-esercenti") → Crea e continua → Fine.
5. Clicca sull'account di servizio appena creato → scheda **Chiavi** →
   *Aggiungi chiave* → *Crea nuova chiave* → formato **JSON** → Crea. Si scarica un file `.json`.
6. Apri il file JSON: ti servono i campi `client_email` e `private_key`.

### 2. Condividi i due Google Sheet con il Service Account

Apri sia il foglio "Database Centrale" sia il foglio "clienti" (Foglio1) e
condividili (pulsante Condividi) con l'indirizzo email presente nel campo
`client_email` del file JSON, dandogli il ruolo **Editor**.

### 3. Aggiungi il codice a GitHub

Se non hai già un account GitHub, creane uno gratuito su github.com. Poi:

```bash
cd dashboard-esercenti
git add -A
git commit -m "Dashboard esercenti - versione iniziale"
```

Crea un nuovo repository vuoto su github.com (es. "dashboard-esercenti"),
poi segui le istruzioni che GitHub mostra per collegare questa cartella
("push an existing repository").

### 4. Crea il progetto su Vercel (gratis)

1. Vai su https://vercel.com/ → registrati con GitHub (gratis).
2. *Add New* → *Project* → seleziona il repository appena creato.
3. Prima di cliccare "Deploy", apri *Environment Variables* e inserisci:
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` → il `client_email` del JSON
   - `GOOGLE_PRIVATE_KEY` → il `private_key` del JSON (incollalo intero, comprese le `\n`)
   - `ESERCENTI_SPREADSHEET_ID` → `1VMfFy6EE_2Gd21nqbRiVIiWjKgBpfnO29DDs1kOQcSo`
   - `ESERCENTI_SHEET_NAME` → `Untitled`
   - `CLIENTI_SPREADSHEET_ID` → `11fLuD3xwFTrcx2Ak4DxXiC_NvOfO6_vw5o4P_qRYKbU`
   - `CLIENTI_SHEET_NAME` → `Foglio1`
   - `SESSION_SECRET` → una stringa lunga e casuale a tua scelta (almeno 32 caratteri)
4. Clicca *Deploy*. In 1-2 minuti l'app è online su un indirizzo tipo
   `dashboard-esercenti-xxxx.vercel.app`.

### 5. Collega il tuo dominio

1. Su Vercel: progetto → *Settings* → *Domains* → aggiungi
   `dashboard.recensionia5stelle.it`.
2. Vercel mostrerà un record CNAME da aggiungere. Vai sul pannello DNS di
   Aruba e aggiungi quel record esattamente come indicato (stesso procedimento
   già fatto per il sottodominio email di Brevo).
3. Attendi la propagazione DNS (di solito pochi minuti, a volte fino a qualche ora).

Fatto: la dashboard sarà raggiungibile su `https://dashboard.recensionia5stelle.it`.

## Note

- Ogni esercente riceve email + codice di accesso automaticamente al momento
  dell'attivazione dell'abbonamento (lo scenario Make "Integration Tally" è
  già stato aggiornato per generarlo e inviarlo).
- Per gli esercenti già registrati prima di oggi, il codice è già stato
  generato nella colonna P del Database Centrale — vai a controllarli e
  inviali manualmente se necessario.
