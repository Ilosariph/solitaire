import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMove, bestMove, canAutoFinish, canPlace, deal, draw, finishMove, hint, isLegal, isWon, movable,
} from '../public/js/solitaire.js';

// Card ids: suit * 13 + rank - 1, suits ♠ ♥ ♦ ♣.
const card = (rank, suit) => '♠♥♦♣'.indexOf(suit) * 13 + rank - 1;

const empty = () => ({
  stock: [], waste: [], foundations: [[], [], [], []],
  tableau: Array.from({ length: 7 }, () => ({ cards: [], down: 0 })),
});

test('same seed gives the same deal, all 52 cards once', () => {
  assert.deepEqual(deal('abc'), deal('abc'));
  assert.notDeepEqual(deal('abc'), deal('abd'));
  const s = deal('xyz');
  const all = [...s.stock, ...s.tableau.flatMap(t => t.cards)];
  assert.equal(all.length, 52);
  assert.equal(new Set(all).size, 52);
  s.tableau.forEach((t, i) => {
    assert.equal(t.cards.length, i + 1);
    assert.equal(t.down, i);
  });
  assert.equal(s.stock.length, 24);
});

test('tableau stacking needs alternating colour and descending rank', () => {
  const s = empty();
  s.tableau[0].cards = [card(8, '♠')];
  assert.ok(canPlace(s, [card(7, '♥')], 't0'));
  assert.ok(!canPlace(s, [card(7, '♣')], 't0'));
  assert.ok(!canPlace(s, [card(6, '♥')], 't0'));
  assert.ok(canPlace(s, [card(13, '♦')], 't1'));
  assert.ok(!canPlace(s, [card(12, '♦')], 't1'));
});

test('foundations build up by suit from the ace', () => {
  const s = empty();
  assert.ok(canPlace(s, [card(1, '♥')], 'f2'));
  assert.ok(!canPlace(s, [card(2, '♥')], 'f2'));
  s.foundations[0] = [card(1, '♥')];
  assert.ok(canPlace(s, [card(2, '♥')], 'f0'));
  assert.ok(!canPlace(s, [card(2, '♦')], 'f0'));
  assert.ok(!canPlace(s, [card(2, '♥'), card(1, '♠')], 'f0'));
});

test('moving the last face-up card flips the one beneath', () => {
  const s = empty();
  s.tableau[0] = { cards: [card(3, '♣'), card(9, '♦')], down: 1 };
  s.tableau[1].cards = [card(10, '♠')];
  const n = applyMove(s, { from: 't0', count: 1, to: 't1' });
  assert.deepEqual(n.tableau[0], { cards: [card(3, '♣')], down: 0 });
  assert.deepEqual(n.tableau[1].cards, [card(10, '♠'), card(9, '♦')]);
  assert.equal(s.tableau[0].down, 1, 'original state untouched');
});

test('runs move only if face up and properly stacked', () => {
  const s = empty();
  s.tableau[0] = { cards: [card(5, '♣'), card(9, '♠'), card(8, '♥'), card(7, '♣')], down: 1 };
  assert.deepEqual(movable(s, 't0', 3), [card(9, '♠'), card(8, '♥'), card(7, '♣')]);
  assert.equal(movable(s, 't0', 4), null);
  s.tableau[1] = { cards: [card(9, '♠'), card(4, '♥')], down: 0 };
  assert.equal(movable(s, 't1', 2), null);
});

test('draw turns cards and recycles the waste in order', () => {
  let s = { ...empty(), stock: [1, 2, 3, 4, 5] };
  s = draw(s, 3);
  assert.deepEqual(s.stock, [1, 2]);
  assert.deepEqual(s.waste, [5, 4, 3]);
  s = draw(s, 3);
  assert.deepEqual(s.waste, [5, 4, 3, 2, 1]);
  s = draw(s, 3);
  assert.deepEqual(s.stock, [1, 2, 3, 4, 5]);
  assert.deepEqual(s.waste, []);
  assert.equal(draw(empty(), 1), null);
});

test('bestMove prefers the foundation, and skips pointless king shuffles', () => {
  const s = empty();
  s.tableau[0].cards = [card(1, '♠')];
  assert.deepEqual(bestMove(s, 't0', 1), { from: 't0', count: 1, to: 'f0' });
  s.tableau[0].cards = [card(13, '♠')];
  assert.equal(bestMove(s, 't0', 1), null);
  s.tableau[0] = { cards: [card(2, '♦'), card(13, '♠')], down: 1 };
  assert.equal(bestMove(s, 't0', 1).to, 't1');
});

test('hint suggests revealing moves, then drawing', () => {
  const s = empty();
  s.tableau[0] = { cards: [card(4, '♣'), card(9, '♦')], down: 1 };
  s.tableau[1].cards = [card(10, '♠')];
  s.stock = [card(2, '♥')];
  assert.deepEqual(hint(s), { from: 't0', count: 1, to: 't1' });
  s.tableau[1].cards = [card(10, '♥')];
  assert.deepEqual(hint(s), { draw: true });
});

test('auto-finish plays everything up and wins', () => {
  let s = empty();
  // Each suit as a descending face-up run in its own column.
  for (let suit = 0; suit < 4; suit++) {
    for (let r = 13; r >= 1; r--) s.tableau[suit].cards.push(suit * 13 + r - 1);
  }
  assert.ok(canAutoFinish(s));
  let steps = 0;
  while (!isWon(s)) {
    const m = finishMove(s);
    assert.ok(m && isLegal(s, m));
    s = applyMove(s, m);
    steps++;
  }
  assert.equal(steps, 52);
  assert.ok(!canAutoFinish(s));
});
