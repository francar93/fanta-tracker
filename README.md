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

| Nome file | Finestra | Effetto |
| :--- | :--- | :--- |
| `gufipersempre-3.xlsx` | Mercato | ogni uscita non esente vale +1 cambio |
| `gufipersempre-scambi-3.xlsx` | Scambi | i movimenti con controparte nella lega sono esenti |

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

## Test

```bash
npm test
```

## Struttura

```
backend/src/core/    motore puro: parser xlsx, diff di lega, cascata, render Markdown
backend/src/cli/     entry point da terminale
backend/test/        test sulle regole + test end-to-end sui file reali
assets/input/        export Excel di esempio
assets/docs/         analisi funzionale e tecnica
```

Frontend Angular, API REST con lowdb e Docker/NGINX sono previsti ma non ancora implementati: vedi
[CLAUDE.md](CLAUDE.md) per l'architettura target e le regole di business in dettaglio.
