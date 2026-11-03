import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, finishGame } from '../dist/engine.js';
import { choosePartialMove, partialCertificate, validPartialLoop, validatePartialState, validatePartialPlan, expandPartialLoop } from '../dist/partial.js';

function blockedBridge() {
  const game = new SnakeGame({ width: 4, height: 4, algorithm: 'partial' });
  const child = [5, 9, 10, 11, 15, 14, 13, 12, 8, 4, 0, 1];
  game.body = [5, 1, 0]; game.food = 2;
  game.occupied.fill(0); game.body.forEach(c => { game.occupied[c] = 1; });
  game.partialLoop = child;
  game.partialParents = [{ parent: game.cycle, child, detached: [2, 3, 7, 6], bridge: [1, 2, 6, 5] }];
  return game;
}

test('a partial loop can be valid while its full-board parent does not fit the body', () => {
  const game = blockedBridge();
  assert.equal(validPartialLoop(game, game.partialLoop), true);
  assert.equal(validPartialLoop(game, game.cycle), false);
  assert.equal(validatePartialState(game), true);
  game.assertInvariants();
  const record = game.partialParents[0];
  game.partialParents = [{ ...record, detached: [2, 3, 7, 7] }];
  assert.equal(validatePartialState(game), false);
  game.partialParents = [{ ...record, bridge: [1, 2, 5, 6] }];
  assert.equal(validatePartialState(game), false);
  game.partialParents = [{ ...record, parent: [...record.parent].reverse() }];
  assert.equal(validatePartialState(game), false);
});

test('expansion waits for the body edge to clear, then restores every omitted cell', () => {
  const game = blockedBridge();
  assert.equal(expandPartialLoop(game), false);
  for (const next of [9, 10]) {
    game.occupied[game.body.pop()] = 0;
    game.body.unshift(next); game.occupied[next] = 1;
    game.assertInvariants();
    if (next === 9) assert.equal(expandPartialLoop(game), false);
  }
  const before = [...game.body];
  assert.equal(expandPartialLoop(game), true);
  assert.equal(game.partialLoop.length, 16);
  assert.equal(game.partialParents.length, 0);
  assert.deepEqual(game.body, before);
  game.assertInvariants();
});

test('cycle-cover planning and route search do not peek at food randomness or move the body', () => {
  const game = new SnakeGame({ width: 8, height: 8, algorithm: 'partial' });
  const reference = new SnakeGame({ width: 8, height: 8, algorithm: 'partial' });
  const body = [...game.body], food = game.food;
  for (const variant of [0, 1]) {
    const certificate = partialCertificate(game, body, variant);
    assert.ok(certificate);
    const state = Object.create(game);
    Object.assign(state, { partialLoop: certificate.loop, partialParents: certificate.parents });
    assert.equal(validatePartialState(state), true);
  }
  choosePartialMove(game);
  assert.deepEqual(game.body, body); assert.equal(game.food, food);
  assert.equal(game.random(), reference.random());
  if (game.activePlan) {
    assert.equal(validatePartialPlan(game, game.activePlan), true);
    assert.equal(validatePartialPlan(game, { ...game.activePlan, cursor: -1 }), false);
  }
});

test('partial loops complete narrow, rectangular and square boards within their per-food bound', () => {
  for (const [width, height, count] of [[2, 2, 12], [2, 7, 12], [7, 2, 12], [4, 3, 12], [4, 4, 20], [8, 8, 10], [12, 12, 2], [16, 16, 1]]) {
    for (let seed = 0; seed < count; seed++) {
      const game = finishGame(new SnakeGame({ width, height, seed, algorithm: 'partial' }), true);
      assert.equal(game.status, 'won', `${width}x${height} seed ${seed}`);
      assert.equal(game.body.length, game.size);
      const bound = Math.floor(game.size / 4) * (game.size - 1);
      for (let i = 1; i < game.history.length; i++) assert.ok(game.history[i][0] - game.history[i - 1][0] <= bound);
    }
  }
});
