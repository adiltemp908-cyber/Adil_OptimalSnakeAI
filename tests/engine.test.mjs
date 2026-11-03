import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, ALGORITHMS, makeCycle, finishGame, summarize, repairCycle, repairCompactCycle } from '../dist/engine.js';
import { findCertifiedRoute, completeHamiltonianCycle, simulateRoute, cycleContainsBody, validatePlan } from '../dist/certified.js';
import { readFileSync } from 'node:fs';

test('cycles support even-by-odd, odd-by-even, and narrow rectangles', () => {
  for (const [width, height] of [[2, 2], [2, 9], [9, 2], [3, 4], [4, 3], [12, 12], [20, 20]]) {
    const game = new SnakeGame({ width, height });
    assert.equal(game.assertInvariants(), true);
  }
  for (const [w, h] of [[3, 3], [1, 8], [4.5, 4], [0, 4]]) assert.throws(() => makeCycle(w, h));
});

test('all eight default solvers complete regression seeds with every-step checks', () => {
  for (const [width, height, seeds] of [[2, 2, 20], [2, 7, 20], [7, 2, 20], [4, 3, 40], [4, 4, 80], [6, 6, 60], [8, 8, 40], [12, 12, 12], [20, 20, 3]]) {
    for (let seed = 0; seed < seeds; seed++) for (const algorithm of ALGORITHMS) {
      const game = finishGame(new SnakeGame({ width, height, seed, algorithm }), true);
      assert.equal(game.status, 'won', `${width}x${height} / ${algorithm} / seed ${seed}`);
      assert.equal(game.body.length, width * height);
      assert.equal(game.moves <= game.moveLimit, true);
    }
  }
});

test('seeded simulation is reproducible including dynamic repairs', () => {
  for (const algorithm of ALGORITHMS) {
    const a = finishGame(new SnakeGame({ seed: 4294967295, algorithm }));
    const b = finishGame(new SnakeGame({ seed: 4294967295, algorithm }));
    assert.deepEqual(a.history, b.history);
    assert.deepEqual(a.cycle, b.cycle);
    assert.equal(a.moves, b.moves);
  }
});

test('dynamic repair changes the cycle and keeps a safe, shorter route', () => {
  let changed = 0;
  for (let seed = 0; seed < 30; seed++) {
    const game = new SnakeGame({ width: 8, height: 8, seed, algorithm: 'repair' });
    const previous = [...game.cycle];
    const distance = game.distance(game.body[0], game.food);
    if (repairCycle(game)) {
      assert.notDeepEqual(game.cycle, previous);
      assert.equal(game.distance(game.body[0], game.food) < distance, true);
      game.assertInvariants();
      changed++;
    }
  }
  assert.ok(changed > 0, 'The third solver must actually repair cycles.');
});

test('moving into a departing tail is legal; filling the final free cell wins', () => {
  const game = new SnakeGame({ width: 2, height: 2, algorithm: 'shortcut' });
  // A length-two snake can have the successor as its departing tail.
  game.body = [game.cycle[0], game.cycle[1]];
  game.occupied.fill(0);
  game.body.forEach(c => { game.occupied[c] = 1; });
  game.food = game.cycle[2];
  game.assertInvariants();
  game.step();
  assert.equal(game.body[0], game.cycle[1]);
  assert.equal(game.body.length, 2);
  assert.equal(game.status, 'running');
  game.assertInvariants();
  const final = new SnakeGame({ width: 2, height: 2, algorithm: 'shortcut' });
  final.step();
  assert.equal(final.status, 'won');
  final.assertInvariants();
});

test('statistics report failures separately and use successful games for move averages', () => {
  const summary = summarize([{ algorithm: 'cycle', status: 'won', moves: 10, elapsedMs: 1, repairs: 0, shortcuts: 0 }, { algorithm: 'cycle', status: 'failed', moves: 2, elapsedMs: 3 }])[0];
  assert.equal(summary.wins, 1);
  assert.equal(summary.games, 2);
  assert.equal(summary.meanMoves, 10);
  assert.equal(summary.meanMs, 2);
});

test('compact search preserves every body edge, improves live distance, and never consumes food randomness', () => {
  let improvements = 0;
  for (let seed = 100; seed < 120; seed++) {
    const game = new SnakeGame({ width: 8, height: 8, seed, algorithm: 'compact' });
    const reference = new SnakeGame({ width: 8, height: 8, seed, algorithm: 'compact' });
    const before = game.distance(game.body[0], game.food);
    const body = [...game.body], food = game.food;
    if (repairCompactCycle(game, 512)) {
      improvements++;
      assert.ok(game.distance(game.body[0], food) < before);
    }
    assert.deepEqual(game.body, body);
    assert.equal(game.food, food);
    assert.equal(game.random(), reference.random());
    game.assertInvariants();
  }
  assert.ok(improvements > 0);
});

test('fixed baselines and per-move planners retain their recorded seed-42 results', () => {
  for (const [algorithm, moves] of [['cycle', 5080], ['shortcut', 4690], ['repair', 3319], ['compact', 2019], ['certified', 1750]]) {
    const game = finishGame(new SnakeGame({ algorithm, seed: 42 }));
    assert.equal(game.moves, moves);
    assert.equal(game.status, 'won');
  }
});

test('dynamic and compact repair immediately exploit improvements unlocked between meals', () => {
  const positions = JSON.parse(readFileSync(new URL('./tail-repair-positions.json', import.meta.url)));
  for (const position of positions) {
    const game = new SnakeGame(position);
    Object.assign(game, { body: [...position.body], cycle: [...position.cycle], moves: position.moves, foods: position.foods, food: position.food, needsRepair: false });
    game.cycle.forEach((cell, index) => { game.positions[cell] = index; });
    game.occupied.fill(0); game.body.forEach(cell => { game.occupied[cell] = 1; });
    game.assertInvariants();
    assert.notEqual(game.moves % 4, 0);
    const before = game.progressMeasure();
    game.step(); game.assertInvariants();
    assert.ok(game.repairs > 0, `${game.algorithm} skipped a newly available repair`);
    assert.ok(game.progressMeasure() < before - 1);
  }
});

test('tail-edge pruning preserves every decision of exhaustive compact repair', () => {
  for (const algorithm of ['compact', 'certified', 'hybrid', 'partial', 'greedy_partial']) for (const seed of [0, 42]) {
    const cached = new SnakeGame({ algorithm, width: 8, height: 8, seed });
    const exhaustive = new SnakeGame({ algorithm, width: 8, height: 8, seed });
    Object.defineProperty(exhaustive, 'compactExhausted', { get: () => null, set: () => {} });
    while (cached.status === 'running') {
      cached.step(); exhaustive.step(); cached.assertInvariants();
      assert.deepEqual(cached.body, exhaustive.body, `${algorithm}/${seed}/${cached.moves}`);
      assert.deepEqual(cached.cycle, exhaustive.cycle);
      assert.equal(cached.food, exhaustive.food);
      assert.equal(cached.status, exhaustive.status);
    }
    assert.deepEqual(cached.history, exhaustive.history);
    assert.equal(cached.random(), exhaustive.random());
    if (cached.plannerRandom) assert.equal(cached.plannerRandom(), exhaustive.plannerRandom());
  }
});

test('safe shortcuts immediately considers a cell that the tail just vacated', () => {
  const position = JSON.parse(readFileSync(new URL('./tail-shortcut-position.json', import.meta.url)));
  const game = new SnakeGame(position);
  Object.assign(game, { body: [...position.body], cycle: [...position.cycle], moves: position.moves, foods: position.foods, food: position.food });
  game.cycle.forEach((cell, index) => { game.positions[cell] = index; });
  game.occupied.fill(0); game.body.forEach(cell => { game.occupied[cell] = 1; });
  const oldTail = game.body.at(-1);
  game.step(); game.assertInvariants();
  assert.equal(game.occupied[oldTail], 0);
  assert.equal(game.chooseMove(), oldTail);
  game.step(); game.assertInvariants();
  assert.equal(game.body[0], oldTail);
});

test('certified plans simulate tail movement, preserve food randomness, and reject corrupted certificates', () => {
  const game = new SnakeGame({width:8,height:8,seed:42,algorithm:'certified'});
  const reference = new SnakeGame({width:8,height:8,seed:42,algorithm:'certified'});
  const originalBody = [...game.body], originalCycle = [...game.cycle];
  const plan = findCertifiedRoute(game);
  assert.ok(plan);
  assert.ok(plan.path.length < game.distance(game.body[0],game.food));
  assert.ok(validatePlan(game,plan));
  assert.deepEqual(game.body,originalBody);
  assert.deepEqual(game.cycle,originalCycle);
  assert.equal(game.random(),reference.random());
  const finalBody=simulateRoute(game,plan.path);
  assert.ok(cycleContainsBody(game,plan.cycle,finalBody));
  assert.equal(validatePlan(game,{...plan,cycle:plan.cycle.map(()=>0)}),false);
  assert.equal(validatePlan(game,{...plan,path:[game.body[1],...plan.path]}),false);
  assert.equal(validatePlan(game,{...plan,food:(game.food+1)%game.size}),false);
});

test('certificate search exhaustion leaves the physical game unchanged', () => {
  const game=new SnakeGame({width:8,height:8,seed:42,algorithm:'certified'});
  const before={body:[...game.body],cycle:[...game.cycle],food:game.food,moves:game.moves};
  assert.equal(completeHamiltonianCycle(game,game.body,0),null);
  assert.equal(findCertifiedRoute(game,0),null);
  assert.deepEqual({body:game.body,cycle:game.cycle,food:game.food,moves:game.moves},before);
});

test('a committed route remains valid at every step and restores the certificate at food', () => {
  const game=new SnakeGame({width:8,height:8,seed:42,algorithm:'certified'});
  const plan=findCertifiedRoute(game);
  assert.ok(plan);
  const expected=simulateRoute(game,plan.path), expectedMoves=plan.path.length;
  game.activePlan=plan;
  for(let i=0;i<expectedMoves;i++) {
    const remaining=game.progressMeasure();
    game.step();
    game.assertInvariants();
    if(i<expectedMoves-1)assert.equal(game.progressMeasure(),remaining-1);
  }
  assert.deepEqual(game.body,expected);
  assert.equal(game.moves,expectedMoves);
  assert.equal(game.activePlan,null);
  assert.equal(game.foods,1);
  assert.ok(cycleContainsBody(game,game.cycle,game.body));
});

test('the last food can be certified as an immediate full-board win', () => {
  const game=new SnakeGame({width:2,height:2,algorithm:'certified'});
  const plan={path:[game.food],cycle:null,cursor:0,food:game.food};
  assert.ok(validatePlan(game,plan));
  game.activePlan=plan;game.step();
  assert.equal(game.status,'won');game.assertInvariants();
});
