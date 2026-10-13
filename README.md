# Klondike solitaire, ad-free.

Static site (HTML/CSS/vanilla JS, no build step); dealing and all rules run client-side.

## Run

```sh
docker compose up -d           # nginx on port 5000 (expects the external `proxy` network)
npm start                      # → http://localhost:8000 (python3 static server)
```

## Test

```sh
npm test                       # rules tests (node --test, no deps)
```

## Layout

| Path | Purpose |
| --- | --- |
| `public/js/solitaire.js` | Seeded PRNG, deal, move rules, hints, auto-finish |
| `public/js/main.js` | Rendering, drag & drop / tap input, undo, timer, save/restore |
| `public/styles.css` | All styles |
| `Dockerfile`, `nginx.conf`, `docker-compose.yml` | Container serving the static site via nginx |
