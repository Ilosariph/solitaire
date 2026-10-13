// Pure Klondike logic: seeded deals, move validation and hints.
// Cards are ids 0–51: suit = id / 13 (♠ ♥ ♦ ♣), rank = id % 13 + 1 (A=1 … K=13).
// Pile keys: 's' stock, 'w' waste, 'f0'–'f3' foundations, 't0'–'t6' tableau.
// The last element of every pile array is its top card.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const FOUNDATIONS = ['f0', 'f1', 'f2', 'f3'];
export const TABLEAU = ['t0', 't1', 't2', 't3', 't4', 't5', 't6'];

export const suitOf = id => Math.floor(id / 13);
export const rankOf = id => (id % 13) + 1;
export const isRed = id => suitOf(id) === 1 || suitOf(id) === 2;

// Hashes a seed string into a 32-bit integer (FNV-1a + final avalanche).
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

// Small seedable PRNG so the same seed always yields the same deal.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 0x100000000).toString(16);
}

// Shuffles a deck from the seed and deals 1–7 cards into the tableau,
// only the top card of each column face up. Tableau columns are
// { cards, down }: the first `down` cards are face down.
export function deal(seed) {
  const rand = mulberry32(hashSeed(String(seed)));
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let k = 0;
  const tableau = TABLEAU.map((_, p) => ({ cards: deck.slice(k, (k += p + 1)), down: p }));
  return { stock: deck.slice(k), waste: [], foundations: [[], [], [], []], tableau };
}

export function pile(s, key) {
  if (key === 's') return s.stock;
  if (key === 'w') return s.waste;
  const i = +key.slice(1);
  return key[0] === 'f' ? s.foundations[i] : s.tableau[i].cards;
}

const top = arr => arr[arr.length - 1];

// The cards a move of `count` from `from` would pick up, or null if illegal.
export function movable(s, from, count) {
  const cards = pile(s, from);
  if (count < 1 || count > cards.length) return null;
  if (from === 's') return null;
  if (from[0] !== 't') return count === 1 ? [top(cards)] : null;
  const { down } = s.tableau[+from.slice(1)];
  if (count > cards.length - down) return null;
  const run = cards.slice(cards.length - count);
  for (let i = 1; i < run.length; i++) {
    if (!stacks(run[i], run[i - 1])) return null;
  }
  return run;
}

// Can `card` sit on `under` in the tableau (alternating colour, one lower)?
export const stacks = (card, under) => isRed(card) !== isRed(under) && rankOf(card) === rankOf(under) - 1;

export function canPlace(s, cards, to) {
  const target = pile(s, to);
  const first = cards[0];
  if (to[0] === 'f') {
    if (cards.length !== 1) return false;
    if (!target.length) return rankOf(first) === 1;
    return suitOf(first) === suitOf(top(target)) && rankOf(first) === rankOf(top(target)) + 1;
  }
  if (to[0] === 't') {
    if (!target.length) return rankOf(first) === 13;
    return stacks(first, top(target));
  }
  return false;
}

export function isLegal(s, { from, count, to }) {
  if (from === to) return false;
  const cards = movable(s, from, count);
  return !!cards && canPlace(s, cards, to);
}

const clone = s => ({
  stock: s.stock.slice(),
  waste: s.waste.slice(),
  foundations: s.foundations.map(f => f.slice()),
  tableau: s.tableau.map(t => ({ cards: t.cards.slice(), down: t.down })),
});

// Returns a new state with the move applied; flips the newly exposed
// tableau card. Assumes the move is legal.
export function applyMove(s, { from, count, to }) {
  const n = clone(s);
  const src = pile(n, from);
  pile(n, to).push(...src.splice(src.length - count, count));
  if (from[0] === 't') {
    const col = n.tableau[+from.slice(1)];
    if (col.down > 0 && col.down >= col.cards.length) col.down = col.cards.length - 1;
  }
  return n;
}

// Turns `drawCount` cards from stock to waste, or recycles the waste when
// the stock is empty. Returns null if both are empty.
export function draw(s, drawCount) {
  if (!s.stock.length && !s.waste.length) return null;
  const n = clone(s);
  if (!n.stock.length) {
    n.stock = n.waste.reverse();
    n.waste = [];
  } else {
    for (let i = 0; i < drawCount && n.stock.length; i++) n.waste.push(n.stock.pop());
  }
  return n;
}

export const isWon = s => s.foundations.every(f => f.length === 13);

// Everything is face up and in the tableau: the rest plays itself.
export const canAutoFinish = s =>
  !s.stock.length && !s.waste.length && s.tableau.every(t => t.down === 0) && !isWon(s);

// Next card for auto-finish: the lowest-ranked card that can go up.
export function finishMove(s) {
  let best = null;
  for (const from of ['w', ...TABLEAU]) {
    const card = top(pile(s, from));
    if (card === undefined) continue;
    for (const to of FOUNDATIONS) {
      if (canPlace(s, [card], to) && (!best || rankOf(card) < best.rank)) {
        best = { from, count: 1, to, rank: rankOf(card) };
      }
    }
  }
  return best && { from: best.from, count: best.count, to: best.to };
}

// A tableau move that changes nothing worth having: a king (or any run)
// sliding off an already empty base onto another empty column.
function pointless(s, { from, count, to }) {
  if (from[0] !== 't' || to[0] !== 't') return false;
  const col = s.tableau[+from.slice(1)];
  return !pile(s, to).length && col.down === 0 && count === col.cards.length;
}

// Best destination for a tapped card/run: foundation first (single cards),
// then a non-empty tableau column, then an empty one.
export function bestMove(s, from, count) {
  const cards = movable(s, from, count);
  if (!cards) return null;
  const targets = [];
  if (count === 1 && from[0] !== 'f') targets.push(...FOUNDATIONS);
  const cols = TABLEAU.filter(t => t !== from);
  targets.push(...cols.filter(t => pile(s, t).length), ...cols.filter(t => !pile(s, t).length));
  for (const to of targets) {
    const move = { from, count, to };
    if (canPlace(s, cards, to) && !pointless(s, move)) return move;
  }
  return null;
}

// Suggests a productive move, or { draw: true } to turn the stock, or null.
// Order: free a face-down card, play to foundation, use the waste.
export function hint(s) {
  const reveal = [], up = [], waste = [];
  for (const from of TABLEAU) {
    const col = s.tableau[+from.slice(1)];
    const faceUp = col.cards.length - col.down;
    if (!faceUp) continue;
    const topMove = FOUNDATIONS.map(to => ({ from, count: 1, to })).find(m => isLegal(s, m));
    if (topMove) (faceUp === 1 && col.down ? reveal : up).push(topMove);
    // Whole face-up run onto another column: reveals a card or empties a column.
    for (const to of TABLEAU) {
      const m = { from, count: faceUp, to };
      if (isLegal(s, m) && !pointless(s, m) && (col.down || pile(s, to).length)) {
        (col.down ? reveal : up).push(m);
      }
    }
  }
  if (s.waste.length) {
    for (const to of [...FOUNDATIONS, ...TABLEAU]) {
      const m = { from: 'w', count: 1, to };
      if (isLegal(s, m)) waste.push(m);
    }
  }
  const move = reveal[0] || up.find(m => m.to[0] === 'f') || waste[0] || up[0];
  if (move) return move;
  return s.stock.length || s.waste.length ? { draw: true } : null;
}
