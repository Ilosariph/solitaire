import {
  applyMove, bestMove, canAutoFinish, canPlace, deal, draw, finishMove, FOUNDATIONS, hint,
  isRed, isWon, movable, pile, randomSeed, RANKS, rankOf, SUITS, suitOf, TABLEAU,
} from './solitaire.js';

const $ = s => document.querySelector(s);

const DRAG_THRESHOLD = 6;
const FINISH_STEP_MS = 90;
const MAX_HISTORY = 1000;

const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
  del: k => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};

// Dark mode
const darkToggle = $('#darkToggle');
function applyDark(on) {
  document.documentElement.classList.toggle('dark', on);
  darkToggle.textContent = on ? '☀' : '☾';
  store.set('dark', on ? '1' : '');
}
applyDark(store.get('dark') === '1');
darkToggle.addEventListener('click', () => applyDark(!document.documentElement.classList.contains('dark')));

// game: { seed, drawCount, state, history, moves, elapsed, status }
// status: 'ready' (no move yet) | 'playing' | 'finishing' | 'won'
let game = null;
let timerInterval = null;
let drag = null;
let geo = null;           // layout metrics, see measure()
let pos = [];             // pos[id] = { x, y, z } of each card as last rendered

const boardEl = $('#board');
const cardEls = [];
const slotEls = {};

// ── Board DOM: 13 slots + 52 persistent card elements ──

function buildBoard() {
  for (const key of ['s', 'w', ...FOUNDATIONS, ...TABLEAU]) {
    const el = document.createElement('div');
    el.className = 'slot' + (key === 's' ? ' stock' : '');
    el.dataset.key = key;
    if (key[0] === 'f') el.textContent = 'A';
    if (key[0] === 't') el.textContent = 'K';
    boardEl.appendChild(el);
    slotEls[key] = el;
  }
  for (let id = 0; id < 52; id++) {
    const el = document.createElement('div');
    const rank = RANKS[rankOf(id) - 1], suit = SUITS[suitOf(id)];
    el.className = 'card' + (isRed(id) ? ' red' : '');
    el.dataset.id = id;
    const center = rankOf(id) > 10
      ? `<span class="pip court">${rank}<i>${suit}</i></span>`
      : `<span class="pip">${suit}</span>`;
    el.innerHTML = `<div class="face"><span class="corner">${rank}<i>${suit}</i></span>${center}`
      + `<span class="corner br">${rank}<i>${suit}</i></span></div><div class="back"></div>`;
    boardEl.appendChild(el);
    cardEls.push(el);
  }
}

// ── Layout ──

function measure() {
  const w = boardEl.clientWidth;
  const gap = Math.max(4, Math.min(14, w * 0.018));
  const cw = Math.min(96, (w - gap * 6) / 7);
  const ch = cw * 1.4;
  const tabY = ch + gap * 2;
  // Room for the tableau before the page would have to scroll.
  const boardTop = boardEl.getBoundingClientRect().top + window.scrollY;
  const avail = Math.max(ch * 3, window.innerHeight - boardTop - tabY - 16);
  geo = { gap, cw, ch, tabY, avail, colX: i => i * (cw + gap) };
  boardEl.style.setProperty('--cw', `${cw}px`);
  boardEl.style.setProperty('--ch', `${ch}px`);
}

// Vertical fan offsets for a column, squeezed if it would overflow.
function fanOffsets(col) {
  const { ch, avail } = geo;
  let down = ch * 0.12, up = ch * 0.27;
  const n = col.cards.length, faceUp = n - col.down;
  const need = col.down * down + Math.max(0, faceUp - 1) * up + ch;
  if (n > 1 && need > avail) {
    const f = Math.max(0.4, (avail - ch) / (need - ch));
    down *= f; up *= f;
  }
  return { down, up };
}

function slotPos(key) {
  const { colX, tabY } = geo;
  if (key === 's') return { x: colX(0), y: 0 };
  if (key === 'w') return { x: colX(1), y: 0 };
  if (key[0] === 'f') return { x: colX(3 + +key[1]), y: 0 };
  return { x: colX(+key[1]), y: tabY };
}

function layoutCards() {
  const s = game.state;
  const out = [];
  let maxY = geo.tabY + geo.ch;
  s.stock.forEach((id, i) => out[id] = { ...slotPos('s'), z: i, up: false });
  const fan = game.drawCount === 3 ? 3 : 1;
  const wp = slotPos('w');
  s.waste.forEach((id, i) => {
    const k = Math.max(0, i - Math.max(0, s.waste.length - fan));
    out[id] = { x: wp.x + k * geo.cw * 0.3, y: 0, z: i, up: true };
  });
  for (const key of FOUNDATIONS) {
    const p = slotPos(key);
    pile(s, key).forEach((id, i) => out[id] = { ...p, z: i, up: true });
  }
  s.tableau.forEach((col, t) => {
    const p = slotPos(TABLEAU[t]);
    const off = fanOffsets(col);
    let y = p.y;
    col.cards.forEach((id, i) => {
      out[id] = { x: p.x, y, z: i, up: i >= col.down };
      maxY = Math.max(maxY, y + geo.ch);
      y += i < col.down ? off.down : off.up;
    });
  });
  return { out, height: maxY };
}

// `lift` lists cards to keep on top while they fly back (cancelled drags).
function render(lift = []) {
  const { out, height } = layoutCards();
  const prev = pos;
  pos = out;
  const animate = !boardEl.classList.contains('no-anim');
  boardEl.style.height = `${height}px`;
  for (const [key, el] of Object.entries(slotEls)) {
    const p = slotPos(key);
    el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }
  const s = game.state;
  slotEls.s.textContent = s.waste.length ? '↻' : '';
  slotEls.s.classList.toggle('empty-all', !s.stock.length && !s.waste.length);
  out.forEach((p, id) => {
    const el = cardEls[id];
    const t = `translate(${p.x}px, ${p.y}px)`;
    const z = (p.y > 0 ? 100 : 10) + p.z;
    el.classList.toggle('up', p.up);
    // Cards in flight ride above everything until they land.
    const moving = prev[id] && (prev[id].x !== p.x || prev[id].y !== p.y);
    el.style.zIndex = animate && (moving || lift.includes(id)) ? 400 + z : z;
    el.dataset.z = z;
    el.style.transform = t;
  });
  $('#movesDisplay').textContent = `${game.moves} move${game.moves === 1 ? '' : 's'}`;
  $('#undoBtn').disabled = !game.history.length || game.status === 'finishing' || game.status === 'won';
  $('#hintBtn').disabled = game.status === 'finishing' || game.status === 'won';
}

boardEl.addEventListener('transitionend', e => {
  if (e.target.classList.contains('card') && e.propertyName === 'transform') e.target.style.zIndex = e.target.dataset.z;
});

function relayout() {
  boardEl.classList.add('no-anim');
  measure();
  render();
  requestAnimationFrame(() => boardEl.classList.remove('no-anim'));
}
window.addEventListener('resize', () => { if (game) relayout(); });

// ── Game flow ──

function newGame(seed, drawCount) {
  game = { seed, drawCount, state: deal(seed), history: [], moves: 0, elapsed: 0, status: 'ready' };
  $('#seedInput').value = '';
  $('#winBanner').hidden = true;
  showSeed();
  stopTimer();
  updateTimer();
  relayout();
  store.del('save');
}

function showSeed() {
  $('#seedDisplay').innerHTML = `seed <code>${escapeHtml(game.seed)}</code> · draw ${game.drawCount}`;
}

const escapeHtml = s => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function loadFromControls() {
  const seed = $('#seedInput').value.trim() || randomSeed();
  newGame(seed, +$('#drawSelect').value);
}

function commit(next) {
  game.history.push({ state: game.state, moves: game.moves });
  if (game.history.length > MAX_HISTORY) game.history.shift();
  game.state = next;
  game.moves++;
  if (game.status === 'ready') { game.status = 'playing'; startTimer(); }
  render();
  afterMove();
}

function afterMove() {
  if (isWon(game.state)) return win();
  if (canAutoFinish(game.state)) return autoFinish();
  save();
}

function tryMove(move) {
  if (!move || game.status === 'finishing' || game.status === 'won') return false;
  const cards = movable(game.state, move.from, move.count);
  if (!cards || move.from === move.to || !canPlace(game.state, cards, move.to)) return false;
  commit(applyMove(game.state, move));
  return true;
}

function drawStock() {
  if (game.status === 'finishing' || game.status === 'won') return;
  const next = draw(game.state, game.drawCount);
  if (next) commit(next);
}

function undo() {
  if (!game.history.length || game.status === 'finishing' || game.status === 'won') return;
  const prev = game.history.pop();
  game.state = prev.state;
  game.moves = prev.moves;
  render();
  save();
}

function autoFinish() {
  const g = game;
  g.status = 'finishing';
  render();
  const step = () => {
    if (game !== g) return; // a new game was started meanwhile
    const move = finishMove(game.state);
    if (!move) return;
    game.state = applyMove(game.state, move);
    game.moves++;
    render();
    if (isWon(game.state)) win();
    else setTimeout(step, FINISH_STEP_MS);
  };
  setTimeout(step, FINISH_STEP_MS);
}

function win() {
  game.status = 'won';
  stopTimer();
  render();
  store.del('save');
  const banner = $('#winBanner');
  banner.innerHTML = `Solved!<small>${formatTime(game.elapsed)} · ${game.moves} moves</small>`;
  banner.hidden = false;
  confetti();
}

function showHint() {
  if (game.status === 'finishing' || game.status === 'won') return;
  const h = hint(game.state);
  const flash = els => els.forEach(el => {
    el.classList.remove('hint');
    void el.offsetWidth; // restart the animation
    el.classList.add('hint');
  });
  if (!h) return;
  if (h.draw) return flash([topEl('s') || slotEls.s]);
  const src = pile(game.state, h.from);
  flash([...src.slice(src.length - h.count).map(id => cardEls[id]), topEl(h.to) || slotEls[h.to]]);
}

const topEl = key => {
  const p = pile(game.state, key);
  return p.length ? cardEls[p[p.length - 1]] : null;
};

// ── Persistence: an unfinished game survives a reload ──

function save() {
  if (game.status !== 'playing') return;
  const { seed, drawCount, state, history, moves, elapsed } = game;
  store.set('save', JSON.stringify({ seed, drawCount, state, history: history.slice(-200), moves, elapsed }));
}

function restore() {
  try {
    const g = JSON.parse(store.get('save'));
    if (!g || !g.state || !Array.isArray(g.state.tableau)) return false;
    game = { ...g, status: 'playing' };
    $('#drawSelect').value = String(g.drawCount);
    showSeed();
    updateTimer();
    relayout();
    if (isWon(game.state)) win();
    else { startTimer(); afterMove(); }
    return true;
  } catch {
    return false;
  }
}

// ── Timer ──

const formatTime = sec => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
function updateTimer() { $('#timerDisplay').textContent = formatTime(game.elapsed); }
function startTimer() {
  stopTimer();
  timerInterval = setInterval(() => {
    if (document.hidden) return;
    game.elapsed++;
    updateTimer();
    if (game.elapsed % 10 === 0) save();
  }, 1000);
}
function stopTimer() { clearInterval(timerInterval); timerInterval = null; }

// ── Input: drag & drop, tap to auto-move ──

function locate(id) {
  const s = game.state;
  for (const key of ['s', 'w', ...FOUNDATIONS, ...TABLEAU]) {
    const p = pile(s, key);
    const i = p.indexOf(id);
    if (i >= 0) return { key, index: i, count: p.length - i };
  }
  return null;
}

boardEl.addEventListener('pointerdown', e => {
  if (!game || drag || e.button > 0) return;
  if (game.status === 'finishing' || game.status === 'won') return;
  const cardEl = e.target.closest('.card');
  const slotEl = e.target.closest('.slot');
  if (!cardEl) {
    if (slotEl?.dataset.key === 's') drawStock();
    return;
  }
  const loc = locate(+cardEl.dataset.id);
  if (!loc) return;
  if (loc.key === 's') return drawStock();
  const ids = movable(game.state, loc.key, loc.count);
  if (!ids) return;
  e.preventDefault();
  drag = { from: loc.key, count: loc.count, ids, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, moved: false, pointerId: e.pointerId };
});

window.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.dx = e.clientX - drag.x0;
  drag.dy = e.clientY - drag.y0;
  if (!drag.moved && Math.hypot(drag.dx, drag.dy) < DRAG_THRESHOLD) return;
  if (!drag.moved) {
    drag.moved = true;
    drag.ids.forEach(id => cardEls[id].classList.add('dragging'));
  }
  drag.ids.forEach((id, i) => {
    const p = pos[id];
    const el = cardEls[id];
    el.style.transform = `translate(${p.x + drag.dx}px, ${p.y + drag.dy}px)`;
    el.style.zIndex = 1000 + i;
  });
});

window.addEventListener('pointerup', e => {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const d = drag;
  drag = null;
  d.ids.forEach(id => cardEls[id].classList.remove('dragging'));
  if (!d.moved) {
    if (d.from[0] === 'f') return; // taps never pull cards off a foundation
    if (!tryMove(bestMove(game.state, d.from, d.count))) nudge(d.ids);
    return;
  }
  const to = dropTarget(d);
  if (!to || !tryMove({ from: d.from, count: d.count, to })) render(d.ids);
});

window.addEventListener('pointercancel', () => {
  if (!drag) return;
  const { ids } = drag;
  ids.forEach(id => cardEls[id].classList.remove('dragging'));
  drag = null;
  render(ids);
});

// The legal pile whose area overlaps the dragged card the most.
function dropTarget(d) {
  const p = pos[d.ids[0]];
  const r = { x: p.x + d.dx, y: p.y + d.dy, w: geo.cw, h: geo.ch };
  let best = null, bestArea = 0;
  for (const key of [...FOUNDATIONS, ...TABLEAU]) {
    if (key === d.from || !canPlace(game.state, d.ids, key)) continue;
    const t = pileRect(key);
    const ox = Math.min(r.x + r.w, t.x + t.w) - Math.max(r.x, t.x);
    const oy = Math.min(r.y + r.h, t.y + t.h) - Math.max(r.y, t.y);
    const area = ox > 0 && oy > 0 ? ox * oy : 0;
    if (area > bestArea) { best = key; bestArea = area; }
  }
  return best;
}

// Tableau columns accept drops along their whole fanned length.
function pileRect(key) {
  const s = slotPos(key);
  const p = pile(game.state, key);
  const bottom = key[0] === 't' && p.length ? pos[p[p.length - 1]].y + geo.ch : s.y + geo.ch;
  return { x: s.x, y: s.y, w: geo.cw, h: bottom - s.y };
}

// No legal move for a tapped card: a little shake.
function nudge(ids) {
  ids.forEach(id => {
    const el = cardEls[id];
    const { x, y } = pos[id];
    el.animate([
      { transform: `translate(${x}px, ${y}px)` },
      { transform: `translate(${x - 4}px, ${y}px)` },
      { transform: `translate(${x + 4}px, ${y}px)` },
      { transform: `translate(${x}px, ${y}px)` },
    ], { duration: 180 });
  });
}

// ── Controls ──

const savedDraw = store.get('drawCount');
if (savedDraw === '1' || savedDraw === '3') $('#drawSelect').value = savedDraw;

$('#newBtn').addEventListener('click', () => { $('#seedInput').value = ''; loadFromControls(); });
$('#retryBtn').addEventListener('click', () => newGame(game.seed, game.drawCount));
$('#seedInput').addEventListener('keydown', e => { if (e.key === 'Enter') loadFromControls(); });
$('#drawSelect').addEventListener('change', () => {
  store.set('drawCount', $('#drawSelect').value);
  newGame(game.seed, +$('#drawSelect').value);
});
$('#undoBtn').addEventListener('click', undo);
$('#hintBtn').addEventListener('click', showHint);

document.addEventListener('keydown', e => {
  if (e.target.closest('input, select') || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z') { e.preventDefault(); undo(); }
  else if (k === 'h' && !e.ctrlKey) showHint();
  else if (k === 'd' && !e.ctrlKey) drawStock();
});

// ── Confetti ──

function confetti() {
  const canvas = $('#confetti-canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const W = canvas.width;
  const H = canvas.height;

  const COLORS = ['#c45d3e', '#2c2826', '#f5c842', '#6a9e6a', '#5b8fc9', '#c47db8'];
  const COUNT = 300;
  const DURATION = 3500;
  const start = performance.now();

  const particles = Array.from({ length: COUNT }, () => ({
    x: Math.random() * W,
    y: H + Math.random() * 20,
    vx: (Math.random() - 0.5) * 8,
    vy: -(Math.random() * 18 + 8),
    angle: Math.random() * Math.PI * 2,
    spin: (Math.random() - 0.5) * 0.3,
    w: Math.random() * 10 + 5,
    h: Math.random() * 5 + 3,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
  }));

  function frame(now) {
    const elapsed = now - start;
    if (elapsed > DURATION) { ctx.clearRect(0, 0, W, H); return; }
    const progress = elapsed / DURATION;
    ctx.clearRect(0, 0, W, H);
    ctx.globalAlpha = 1 - Math.pow(progress, 2);
    for (const p of particles) {
      p.x += p.vx;
      p.vy += 0.18;
      p.y += p.vy;
      p.angle += p.spin;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ── Start ──

buildBoard();
if (!restore()) loadFromControls();
