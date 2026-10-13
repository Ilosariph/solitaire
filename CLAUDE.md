# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

- `npm start` — static server at http://localhost:8000 (python3 http.server on `public/`).
- `npm test` — rules tests via `node --test` (no dependencies).
- `docker compose up` — nginx serving `public/` on port 5000.

## Architecture

Static site, no backend, no build step:

- **`public/js/solitaire.js`** — pure Klondike logic: `deal(seed)` (deterministic via FNV-hashed seed + mulberry32 Fisher–Yates), `movable`, `canPlace`, `applyMove`, `draw`, `bestMove` (tap target), `hint`, `canAutoFinish`/`finishMove`. All functions return new state objects; nothing mutates.
- **`public/js/main.js`** — all UI/game code (ES module).
- **`public/index.html`**, **`public/styles.css`** — markup and styles.

**Key design decisions:**
- Cards are ids 0–51 (`suit = id / 13`, `rank = id % 13 + 1`). Piles are keyed `s`, `w`, `f0`–`f3`, `t0`–`t6`; the last array element is the top card.
- Tableau columns are `{ cards, down }` — the first `down` cards are face down; `applyMove` flips the newly exposed card.
- The deal depends only on the seed, not on draw 1/3, so a seed can be replayed in either mode. Stock recycling is unlimited.
- Rendering keeps 52 persistent absolutely-positioned card elements and only updates their `transform`, so every move animates via CSS transition. Cards whose position changed are lifted (`z-index` 400+) until `transitionend`.
- Tableau fans are squeezed per column so the board fits the viewport height.
- Tap = `bestMove` (foundation first, then a non-empty column, then an empty one); taps never pull cards off a foundation, drags can.
- When stock and waste are empty and every card is face up, the game plays itself out (`autoFinish`).
- Unfinished games are saved in `localStorage` (`save`, history capped at 200) and resumed on reload.

**Frontend state (module globals in main.js):**
- `game` — `{ seed, drawCount, state, history, moves, elapsed, status }`, status `'ready' | 'playing' | 'finishing' | 'won'`
- `pos[id]` — last rendered `{ x, y, z, up }` per card; `drag` — active pointer drag
