import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, finishGame } from '../dist/engine.js';
import { chooseHybridMove, inspectSpace, validateHybridPlan } from '../dist/hybrid.js';
import { cycleContainsBody } from '../dist/certified.js';
import { readFileSync } from 'node:fs';
import { foodExitCost, movingFoodRoutes } from '../dist/routing.js';
import { simulateRoute, validatePlan } from '../dist/certified.js';

function restorePosition(position, algorithm = 'hybrid') {
  const game = new SnakeGame({ width: position.width, height: position.height, algorithm, seed: 42 });
  game.body = [...position.body]; game.food = position.food; game.moves = position.moves;
  game.occupied.fill(0); game.body.forEach(cell => { game.occupied[cell] = 1; });
  game.activePlan = structuredClone(position.plan);
  if (position.cycle) {
    game.cycle = [...position.cycle];
    game.cycle.forEach((cell, index) => { game.positions[cell] = index; });
  }
  return game;
}

const positions = JSON.parse(readFileSync(new URL('./greedy-positions.json', import.meta.url)));

test('photo 1: equal-distance food routes prefer the outer track and a better exit', () => {
  const game = restorePosition(positions[0]);
  const oldCost = foodExitCost(game, simulateRoute(game, game.activePlan.path));
  chooseHybridMove(game);
  assert.equal(game.activePlan.path.length, 12);
  assert.deepEqual(game.activePlan.path.slice(0, 2), [22, 10]);
  assert.ok(game.activePlan.path.slice(2).every(cell => cell < 12));
  assert.ok(foodExitCost(game, simulateRoute(game, game.activePlan.path)) < oldCost);
  assert.ok(validateHybridPlan(game, game.activePlan));
  assert.equal(game.greedyReplans, 1);
});

test('photo 2: route uses body cells exactly when the moving tail releases them', () => {
  const game = restorePosition(positions[1]);
  const oldRemaining = game.activePlan.path.length;
  chooseHybridMove(game);
  assert.equal(oldRemaining, 18);
  assert.equal(game.activePlan.path.length, 12);
  assert.equal(game.activePlan.path[1], 115);
  assert.ok(game.occupied[115]);
  assert.notEqual(115, game.body.at(-1));
  assert.ok(validateHybridPlan(game, game.activePlan));
  const food = game.food;
  let lastRemaining = game.activePlan.path.length;
  while (game.food === food) {
    game.step(); game.assertInvariants();
    if (game.food === food) {
      const remaining = game.activePlan.path.length - game.activePlan.cursor;
      assert.ok(remaining < lastRemaining); lastRemaining = remaining;
    }
  }
  assert.equal(game.moves, positions[1].moves + 12);
});

test('photo 3: replace the stale 15-move detour with a safe 9-move route', () => {
  const game = restorePosition(positions[2]);
  chooseHybridMove(game);
  assert.equal(game.activePlan.path.length, 9);
  assert.ok(validateHybridPlan(game, game.activePlan));
});

test('certified replanning shortens a committed route and supplies a new valid certificate', () => {
  const position = JSON.parse(readFileSync(new URL('./certified-replan-position.json', import.meta.url)));
  const game = restorePosition(position, 'certified');
  assert.ok(validatePlan(game, game.activePlan));
  const oldLength = game.activePlan.path.length;
  game.chooseMove();
  assert.ok(game.activePlan.path.length < oldLength);
  assert.ok(validatePlan(game, game.activePlan));
  assert.equal(game.certifiedReplans, 1);
  game.assertInvariants();
});

test('moving-body search exhaustion does not mutate the game or consume food randomness', () => {
  const game = restorePosition(positions[1]), reference = restorePosition(positions[1]);
  const before = structuredClone({ body: game.body, food: game.food, plan: game.activePlan });
  assert.deepEqual(movingFoodRoutes(game, { maxNodes: 0 }), []);
  assert.deepEqual({ body: game.body, food: game.food, plan: game.activePlan }, before);
  assert.equal(game.random(), reference.random());
});

test('cached recovery searches preserve decisions and food randomness', () => {
  const cached = new SnakeGame({ algorithm: 'hybrid', width: 8, height: 8, seed: 42, hybridThreshold: .65 });
  const reference = new SnakeGame({ algorithm: 'hybrid', width: 8, height: 8, seed: 42, hybridThreshold: .65 });
  reference.disableHybridCache = true;
  finishGame(cached, true); finishGame(reference, true);
  assert.equal(cached.status, reference.status);
  assert.equal(cached.moves, reference.moves);
  assert.deepEqual(cached.history, reference.history);
  assert.deepEqual(cached.body, reference.body);
  assert.equal(cached.random(), reference.random());
  assert.ok(cached.hybridSearchCaches.routes.size <= 512);
  assert.ok(cached.hybridSearchCaches.cycles.size <= 512);
});

test('early decisions need no full-board cycle and do not advance the food RNG', () => {
  const game = new SnakeGame({ algorithm: 'hybrid', seed: 42 });
  const reference = new SnakeGame({ algorithm: 'hybrid', seed: 42 });
  const body = [...game.body], food = game.food;
  game.cycle = null;
  game.positions = null;
  chooseHybridMove(game);
  assert.equal(game.activePlan.kind, 'early');
  assert.equal(game.activePlan.cycle, null);
  assert.ok(validateHybridPlan(game, game.activePlan));
  const lowerBound = Math.abs(body[0] % game.width - food % game.width) + Math.abs(Math.floor(body[0] / game.width) - Math.floor(food / game.width));
  assert.equal(game.activePlan.path.length, lowerBound);
  assert.deepEqual(game.body, body);
  assert.equal(game.food, food);
  assert.equal(game.random(), reference.random());
});

test('each switch setting hands off only to a valid cycle and never returns to greedy mode', () => {
  for (const hybridThreshold of [.15, .25, .35, .5]) {
    const game = new SnakeGame({ algorithm: 'hybrid', seed: 42, hybridThreshold });
    let switched = false, leftOriginalCycle = false;
    while (game.status === 'running') {
      const previousPhase = game.hybridPhase;
      game.step(); game.assertInvariants();
      if (game.hybridPhase !== 'certified') leftOriginalCycle ||= !cycleContainsBody(game, game.cycle, game.body);
      if (previousPhase !== 'certified' && game.hybridPhase === 'certified') {
        switched = true;
        // Current-state handoff may also start a certified off-cycle food plan
        // on that tick; its terminal cycle is checked by assertInvariants().
        assert.ok(game.activePlan || cycleContainsBody(game, game.cycle, game.body));
        assert.ok(game.hybridSwitchActualLength >= game.hybridSwitchLength - 1);
        assert.ok(game.hybridSwitchMove <= game.moves);
      }
      if (switched) assert.equal(game.hybridPhase, 'certified');
    }
    assert.ok(leftOriginalCycle); assert.ok(switched);
    assert.equal(game.status, 'won');
    if (hybridThreshold === .25) {
      assert.equal(game.moves, 1910);
      assert.equal(game.hybridSwitchActualLength, 36);
      assert.equal(game.hybridSwitchMove, 298);
    }
  }
});

test('a handoff route needs a certificate; a locally safe route is insufficient', () => {
  const game = new SnakeGame({ algorithm: 'hybrid', seed: 42 });
  chooseHybridMove(game);
  assert.ok(validateHybridPlan(game, game.activePlan));
  assert.equal(validateHybridPlan(game, { ...game.activePlan, kind: 'handoff' }), false);
  assert.equal(validateHybridPlan(game, { ...game.activePlan, path: [game.body[1], ...game.activePlan.path] }), false);
  assert.equal(validateHybridPlan(game, { ...game.activePlan, food: -1 }), false);
  assert.ok(inspectSpace(game, game.body).safe);
});

test('greedy mode rejects an adjacent food that would trap the head after growth', () => {
  const game = new SnakeGame({ algorithm: 'hybrid', width: 4, height: 4, hybridThreshold: .75 });
  game.body = [2, 6, 7, 11, 10, 9, 8, 4, 0];
  game.occupied.fill(0);
  game.body.forEach(cell => { game.occupied[cell] = 1; });
  game.food = 3;
  assert.ok(inspectSpace(game, game.body).safe);
  assert.equal(validateHybridPlan(game, { kind: 'early', path: [3], cursor: 0, food: 3, cycle: null }), false);
  game.step();
  assert.equal(game.body[0], 1);
  assert.equal(game.food, 3);
  assert.equal(game.body.length, 9);
  game.assertInvariants();
});

test('small boards and a food blocking recovery still complete at default settings', () => {
  for (const [width, height, seed] of [[2, 2, 0], [2, 7, 7], [7, 2, 6], [4, 3, 35], [4, 4, 18], [6, 6, 3], [8, 8, 3]]) {
    const game = finishGame(new SnakeGame({ algorithm: 'hybrid', width, height, seed }), true);
    assert.equal(game.status, 'won', `${width}x${height}, seed ${seed}`);
  }
});

test('heuristic loops have the same finite stop budget in playback and benchmarks', () => {
  const game = new SnakeGame({ algorithm: 'hybrid', width: 8, height: 8 });
  game.moves = (game.size - 3) * (game.size - 1);
  const before = [...game.body];
  assert.equal(game.step(), false);
  assert.equal(game.status, 'timeout');
  assert.deepEqual(game.body, before);
  game.assertInvariants();
  for (const hybridThreshold of [0, 1.1, NaN]) assert.throws(() => new SnakeGame({ algorithm: 'hybrid', hybridThreshold }));
});
