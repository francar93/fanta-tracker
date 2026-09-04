# fanta-tracker

Traccia le operazioni di mercato di una lega di Fantacalcio confrontando gli export Excel delle rose
e calcolando quanti **cambi** ha consumato ogni squadra rispetto al limite stagionale (default 12).

Sono esenti dal conteggio:

- gli **scambi** tra squadre della lega (illimitati);
- le cessioni **all'estero**, segnalate dall'asterisco accanto al nome nel file precedente.

## Mercato o scambi?

L'Excel non permette di distinguere uno scambio concordato da una normale operazione di mercato:
in entrambi i casi il giocatore esce da una squadra e compare in un'altra. La natura della finestra
va quindi **dichiarata nel nome del file**:

| Nome file                     | Finestra | Effetto                                            |
| :---------------------------- | :------- | :------------------------------------------------- |
| `gufipersempre-3.xlsx`        | Mercato  | ogni uscita non esente vale +1 cambio              |
| `gufipersempre-scambi-3.xlsx` | Scambi   | i movimenti con controparte nella lega sono esenti |

Nelle finestre di mercato il report elenca comunque i **possibili scambi non dichiarati** (giocatore
uscito da A ed entrato in B nello stesso step): se erano scambi veri, basta rinominare il file con il
marker `scambi` e rilanciare. Il futuro frontend porrà la stessa domanda in fase di upload.

## Requisiti

Node.js 20+.

## Setup

```bash
npm install
```

## Analisi

```bash
npm run analyze -- assets/input
```

Opzioni: `--max N` per cambiare il limite stagionale, `--json` per l'output grezzo.

```bash
npm run analyze -- assets/input --max 15 --json
```

Si possono anche passare i file esplicitamente; l'ordine del confronto deriva sempre dal suffisso
numerico del nome (`gufipersempre-1.xlsx`, `gufipersempre-2.xlsx`, …), non dall'ordine sulla riga di
comando.

## API REST

```bash
npm run dev
```

Server su `http://localhost:3000` (variabili: `PORT`, `FANTA_DB`).

Documentazione interattiva: **http://localhost:3000/api/docs** (Swagger UI). La spec grezza è su
`/api/openapi.json`, utile per generare il client del frontend.

```bash
curl -F "file=@assets/input/gufipersempre-1.xlsx" localhost:3000/api/snapshots
```

| Metodo      | Rotta                  | Cosa fa                                  |
| :---------- | :--------------------- | :--------------------------------------- |
| `GET`       | `/api/health`          | stato del servizio                       |
| `GET` `PUT` | `/api/settings`        | leggi/imposta il limite stagionale       |
| `GET`       | `/api/snapshots`       | elenco dei file caricati                 |
| `POST`      | `/api/snapshots`       | upload `.xlsx` (multipart, campo `file`) |
| `PATCH`     | `/api/snapshots/:id`   | cambia finestra: `{ "kind": "SCAMBI" }`  |
| `DELETE`    | `/api/snapshots/:id`   | rimuove un caricamento                   |
| `GET`       | `/api/report`          | report stagionale in JSON                |
| `GET`       | `/api/report/markdown` | tabella pronta per Notion                |

Caricare due volte la stessa versione dà `409`: aggiungi `?overwrite=true` per sostituirla. Con
`?max=N` sul report cambi il limite solo per quella risposta, senza toccare le impostazioni.

I dati stanno in `db.json` (ignorato da git): gli snapshot sono salvati già interpretati, quindi i
file Excel originali non servono più dopo l'upload.

## Test

```bash
npm test
```

## Struttura

```
backend/src/core/    motore puro: parser xlsx, diff di lega, cascata, render Markdown
backend/src/api/     API REST Express + persistenza lowdb
backend/src/cli/     entry point da terminale
backend/test/        test sulle regole, end-to-end sui file reali e sull'API
assets/input/        export Excel di esempio
assets/docs/         analisi funzionale e tecnica
```

Frontend Angular e Docker/NGINX sono previsti ma non ancora implementati: vedi [CLAUDE.md](CLAUDE.md)
per l'architettura target e le regole di business in dettaglio.
