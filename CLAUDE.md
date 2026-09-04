# CLAUDE.md

Guida per lavorare su **FantaTracker**. Analisi funzionale di riferimento:
[Analisi_Tecnica_FantaTracker.md](assets/docs/Analisi_Tecnica_FantaTracker.md) — leggerla prima di
modificare la logica di business.

## Cos'è

Applicativo che traccia le operazioni di mercato di una lega di Fantacalcio confrontando gli export
Excel delle rose (`file-1.xlsx`, `file-2.xlsx`, …) e calcolando quanti **cambi** ha consumato ogni
squadra rispetto a un limite stagionale (default 12, configurabile), escludendo le operazioni esenti.

## Stato del progetto

**Fatto**: monorepo npm workspaces, core engine completo in TypeScript (parser xlsx, diff di lega,
finestre mercato/scambi, cascata, render Markdown), CLI, 18 test verdi tra regole di business ed
end-to-end sui file reali.

**Da fare**: API REST + persistenza lowdb, frontend Angular (incluso il quesito "scambi o mercato?"
in fase di upload), Docker/NGINX, recupero crediti per le cessioni all'estero (fase 2 dell'analisi).

## Comandi

```bash
npm install                                  # dalla root, installa il workspace backend
npm test                                     # test suite (node:test via tsx)
npm run typecheck                            # tsc --noEmit
npm run analyze -- assets/input              # report Markdown sui file di esempio
npm run analyze -- assets/input --max 15 --json
```

## Architettura (monorepo npm workspaces)

```
backend/           Node.js 20 + TypeScript (ESM)
  src/core/        motore PURO — nessuna dipendenza da Express o dal filesystem
    types.ts       Player, TeamRoster, RosterSnapshot, Movement, TeamReport, SeasonReport
    normalize.ts   parsing nome/asterisco e chiave di confronto
    parser.ts      lettura .xlsx (exceljs) -> RosterSnapshot
    diff.ts        confronto N-1 vs N a livello di lega -> Movement[]
    engine.ts      cascata su tutti gli snapshot -> SeasonReport
    markdown.ts    render tabelle "Notion ready"
    index.ts       superficie pubblica del core
  src/cli/         entry point da terminale
  test/            helpers.ts costruisce snapshot in memoria senza passare da Excel
frontend/          Angular — DA FARE
docker/            Dockerfile(s), nginx.conf — DA FARE
assets/input/      export .xlsx reali, usati anche come fixture di test
assets/docs/       analisi funzionale
```

Il core resta una libreria pura: input snapshot parsati → output report. Non introdurre `express`,
`fs` o `lowdb` dentro `src/core/` — l'unica eccezione è `parseRosterFile`, che è il confine I/O.

**Ordine di lavoro concordato**: monorepo fin da subito, ma il **primo step è il core engine**
(parser + diff + conteggio + esposizione risultato). Frontend Angular, Docker e NGINX arrivano dopo:
non implementarli finché il core non è completo e testato.

Il core engine deve restare una libreria pura (input: righe parsate → output: report JSON), senza
dipendenze da Express o dal filesystem, così da essere testabile in isolamento e riusabile da CLI e API.

## Formato dei file Excel (verificato su `assets/input/`)

- Un solo foglio, nome `ROSE`.
- Layout a colonne raggruppate, **una squadra ogni 3 colonne**: `A/B`, `D/E`, `G/H`, `J/K`, `M/N`,
  `P/Q`, `S/T`, `V/W`, `Y/Z`, `AB/AC`. La terza colonna di ogni gruppo è vuota (separatore).
- Riga 1: nome squadra nella prima colonna del gruppo, letterale `costo` nella seconda.
- Righe 2..N-1: `nome giocatore` | `costo` (intero).
- Ultima riga: letterale `totale` | somma dei costi. **Va scartata**, non è un giocatore.
- Numero di squadre e di giocatori **non va hardcodato**: derivarlo dalla scansione della riga 1 e
  dalla riga `totale`.
- Il nome file dichiara sia la versione sia la natura della finestra (vedi sotto).
- Un nome può terminare con ` *` (spazio + asterisco), es. `Norton-Cuffy *`, `Leao *`. L'asterisco è
  un **marker**, non parte del nome: normalizzare separando `name` e `flagEstero`.
- I nomi giocatore usano accenti e abbreviazioni (`Tourè E.`, `Milinkovic-Savic V.`, `N'Dri`).
  Confrontare sempre su una chiave normalizzata (trim, collapse spazi, case-insensitive) ma
  **conservare la stringa originale** per l'output.

## Regole di business

Confronto **a cascata**: file N vs file N-1; i delta parziali si sommano nel totale stagionale.
L'ordine dei file deriva dal suffisso numerico nel nome (`-1`, `-2`, …), non dall'ordine di upload.

### Natura della finestra (fondamentale)

**L'Excel non permette di dedurre gli scambi.** Uno scambio concordato e una normale operazione di
mercato ("A svincola il giocatore, B lo prende dagli svincolati") producono lo stesso identico diff:
uscita da A, entrata in B. Dedurre lo scambio da questa coincidenza è **sbagliato** e gonfia gli
esenti — è un errore già commesso e corretto, non reintrodurlo.

La natura della finestra è quindi **dichiarata a monte**, non inferita:

- `XX-3.xlsx` → `MERCATO` (default)
- `XX-scambi-3.xlsx` (o `XX-3-scambi.xlsx`, `trade`, case-insensitive) → `SCAMBI`
- l'opzione `kind` di `parseRosterFile`/`parseRosterBuffer` ha la precedenza sul nome file: è
  l'aggancio per la domanda della UI web in fase di upload ("si tratta di scambi o di mercato?").

Il marker deve essere un **token a sé** tra i trattini: `scambissimo-5.xlsx` resta `MERCATO`.

### Classificazione di un giocatore uscito

1. **`SCAMBIO`** — solo in finestra `SCAMBI` e solo se il giocatore risulta in entrata presso
   un'altra squadra nello stesso step → **non conta**, illimitato. Il match va risolto a livello di
   lega: prima le mappe globali usciti/entrati di tutte le squadre, poi la classificazione. Mai
   squadra per squadra.
2. **`ESTERO`** — il giocatore era marcato con `*` **nel file N-1** (quello in cui era ancora in
   rosa) e non è più presente nel file N → **non conta**. Tracciato nella colonna "Trasferimenti
   Estero (*)". Il recupero crediti al valore d'acquisto è fase 2.
3. **`CAMBIO`** — tutto il resto → **+1**.

La precedenza è quella dell'elenco. In finestra `MERCATO` il caso 1 non si applica mai: la
coincidenza viene registrata in `tradeCandidates` (sezione "Possibili scambi non dichiarati" del
report) perché l'utente si accorga di un file nominato male, ma **conta come cambio**. In finestra
`SCAMBI` un'uscita senza controparte ricade sui casi 2/3 e genera un warning.

Il conteggio è **sul lato uscita**: ogni uscita non esente vale +1. Le entrate sono registrate come
movimenti (`SCAMBIO` se hanno una controparte, altrimenti `SVINCOLO`) ma non incrementano mai il
contatore — così una squadra che rilascia due giocatori e ne pesca due dagli svincolati consuma 2
cambi, non 4. Il flag `countsAsChange` su ogni `Movement` è l'unica fonte di verità del conteggio.

### Semantica delle colonne del report

| Campo | Significato |
| :--- | :--- |
| `operations` | tutte le uscite della stagione, esenti incluse |
| `changes` | solo le uscite che erodono il budget (**già al netto** degli esenti) |
| `foreignTransfers` | uscite esenti per asterisco |
| `trades` | uscite esenti perché scambi dichiarati |
| `remainingChanges` | `max(0, maxChanges - changes)` |

Invariante testata: `operations === changes + foreignTransfers + trades`.

**Attenzione all'equivoco**: `remainingChanges` è `limite - changes`, **non** `limite - changes +
foreignTransfers`. Gli esenti sono già esclusi da `changes`; risommarli concederebbe due volte
l'esenzione. L'esempio §4 del documento di analisi (`4 | 1 | 9`) usa invece la colonna in senso
*lordo*, ed è la fonte dell'ambiguità: nel report la colonna si chiama per questo "Cambi
Conteggiati", con "Operazioni" a fianco per il dato lordo.

## Output

- **API/JSON**: dettaglio di ogni movimento con tipologia (`SCAMBIO` | `ESTERO` | `CAMBIO`).
- **Markdown "Notion ready"**: tabella copiabile in clipboard, formato:

  ```
  | Squadra | Operazioni | Cambi Conteggiati (Max 12) | Trasferimenti Estero (*) | Scambi | Cambi Rimanenti |
  | :--- | :---: | :---: | :---: | :---: | :---: |
  ```

## Convenzioni

- **Lingua**: identificatori, commenti, nomi file e messaggi di commit in **inglese**; testi rivolti
  all'utente (UI, report Markdown, etichette) in **italiano**. I nomi delle squadre restano come
  scritti nel file Excel.
- Parametri configurabili, mai costanti sparse nel codice: `maxChanges` (12), numero squadre
  (derivato), nome foglio (`ROSE`).
- Ogni regola di business (scambio, estero, cambio) va coperta da test con fixture derivate dai file
  reali in `assets/input/`.

## Note

- I due file di esempio (`gufipersempre-1.xlsx`, `gufipersempre-2.xlsx`) sono l'unica verità
  disponibile sul formato: prima di cambiare il parser, verificare l'ipotesi contro di essi.
- L'analisi cita `Atalanta ma non troppo`, nei file la squadra è `Atletico ma non troppo`. Fa fede
  il file Excel.
