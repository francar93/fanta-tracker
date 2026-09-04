# Documento di Analisi Funzionale e Tecnica: FantaTracker

## 1. Vision e Obiettivo del Progetto
Il progetto mira a sviluppare un applicativo per il tracciamento automatico delle operazioni di mercato di una lega di Fantacalcio (composta da 10 squadre, numero modificabile), calcolando i cambi effettuati da ciascuna squadra rispetto a un limite stagionale di 12, numero customizzabile. 
L'applicativo identificherà automaticamente le operazioni "esenti" dal conteggio (giocatori ceduti all'estero contrassegnati da asterisco) e gli "scambi" interni tra le squadre della lega.

## 2. Architettura e Stack Tecnologico
In ottica di scalabilità e futura pubblicazione su GitHub, il progetto adotterà un'architettura a microservizi containerizzata.
*   **Backend**: Node.js (con framework come Express o Fastify). Si occuperà del parsing dei file Excel, della logica di business (confronto a cascata) e dell'esposizione delle API.
*   **Librerie Core (Node)**: `xlsx` o `exceljs` per la lettura dei file; librerie standard per la manipolazione di array/oggetti.
*   **Database**: `lowdb` (basato su file `db.json` locale) per la persistenza dello stato e lo storico dei caricamenti.
*   **Frontend**: Angular. Gestirà l'interfaccia utente, l'upload dei file (drag & drop) e la visualizzazione del report.
*   **Infrastruttura**: Docker e Docker Compose, con NGINX come reverse proxy per servire il frontend Angular e instradare le chiamate API al backend Node.js.

## 3. Regole di Business & Logica di Calcolo

### 3.1. Logica di Versione (Cascata)
Il sistema analizzerà i file in ordine sequenziale basato sulla nomenclatura (es. `file-1.xlsx`, `file-2.xlsx`, `file-3.xlsx`).
Il delta dei cambi verrà calcolato confrontando il File N con il File N-1, sommando poi i risultati parziali per ottenere il totale stagionale.

### 3.2. Il Limite dei 12 Cambi e gli Svincoli Mercato
Ogni giocatore che non è più presente nella rosa (rispetto al file precedente) e che viene sostituito da un nuovo giocatore svincolato, incrementa il contatore dei cambi di 1.

### 3.3. Eccezione 1: La Regola dell'Asterisco (Estero)
Se un giocatore rimosso dalla rosa compare nel nuovo file con un asterisco (`*`) accanto al nome (o se il sistema rileva l'asterisco in fase di analisi della stringa), l'operazione di sostituzione di quel giocatore **non incrementa** il contatore dei cambi. Il sistema dovrà inoltre tracciare il recupero dei crediti al valore di acquisto originale (da implementare in fase 2).

### 3.4. Eccezione 2: Scambi Interni (Trade)
Gli scambi di giocatori tra due o più squadre della lega sono illimitati e non erodono il budget dei 12 cambi stagionali.
*Logica di implementazione algoritmica*: Il backend dovrà prima mappare tutti i giocatori "in uscita" e tutti i giocatori "in entrata" per l'intera lega. Se un giocatore "in entrata" per la Squadra A risulta "in uscita" dalla Squadra B, l'operazione viene classificata come *Scambio* e il contatore dei cambi mercato non viene incrementato.

## 4. Input e Output

*   **Input**: File Excel ufficiali (estensione `.xlsx`) contenenti le rose, con struttura a colonne raggruppate per squadra.
*   **Output Intermedio**: Risposta JSON dal backend Angular con il dettaglio di ogni movimento (giocatore, costo, tipologia di movimento).
*   **Output Finale (UX)**: 
    *   Una dashboard Angular con il report dettagliato.
    *   Un pulsante "Copia per Notion" che genera e copia nella clipboard una tabella formattata in Markdown, pronta per essere incollata nel database/pagina Notion.

**Esempio Output Markdown (Notion Ready):**
| Squadra | Cambi Totali (Max 12) | Trasferimenti Estero (*) | Cambi Rimanenti |
| :--- | :---: | :---: | :---: |
| Atalanta ma non troppo | 4 | 1 | 9 |
| I Molli | 2 | 0 | 10 |
