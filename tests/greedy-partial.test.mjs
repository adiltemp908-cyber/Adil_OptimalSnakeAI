import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, ALGORITHMS, finishGame } from '../dist/engine.js';
import { chooseHybridMove, validateHybridPlan } from '../dist/hybrid.js';
import { PlaybackGroup } from '../dist/playback.js';

test('approach eight shares greedy decisions before its handoff and cannot hand off without a certificate', () => {
  const a = new SnakeGame({ algorithm: 'hybrid' }), b = new SnakeGame({ algorithm: 'greedy_partial' });
  for (let i = 0; i < 100; i++) {
    a.step(); b.step(); b.assertInvariants();
    assert.deepEqual(b.body, a.body); assert.equal(b.food, a.food);
  }
  const game = new SnakeGame({ algorithm: 'greedy_partial' });
  chooseHybridMove(game);
  assert.equal(validateHybridPlan(game, game.activePlan), true);
  assert.equal(validateHybridPlan(game, { ...game.activePlan, kind: 'handoff' }), false);
});

test('greedy-to-partial switches only to a checked expansion certificate and stays there', () => {
  for (const [side, count] of [[2, 5], [4, 10], [8, 15], [12, 2]]) for (let seed = 0; seed < count; seed++) {
    const game = new SnakeGame({ algorithm: 'greedy_partial', width: side, height: side, seed });
    let switched = false;
    while (game.status === 'running') {
      game.step(); game.assertInvariants();
      if (switched) assert.equal(game.hybridPhase, 'partial');
      if (game.hybridPhase === 'partial') {
        switched = true;
        assert.ok(game.hybridSwitchActualLength >= game.hybridSwitchLength - 1);
      }
    }
    assert.equal(game.status, 'won', `${side}x${side} seed ${seed}`);
    assert.ok(switched);
  }
  const game = finishGame(new SnakeGame({ algorithm: 'greedy_partial' }), true);
  assert.equal(game.moves, 2448);
});

test('greedy phase has a finite budget even though partial expansion permits a larger bound', () => {
  const game = new SnakeGame({ algorithm: 'greedy_partial', width: 8, height: 8 });
  game.moves = (game.size - 3) * (game.size - 1);
  const body = [...game.body];
  assert.equal(game.step(), false); assert.equal(game.status, 'timeout');
  assert.deepEqual(game.body, body);
});

test('running only approach eight never invokes excluded solvers and rewinds its phase transition', () => {
  const games = ALGORITHMS.map(algorithm => new SnakeGame({ algorithm, width: 4, height: 4 }));
  const group = new PlaybackGroup(games);
  group.select(['greedy_partial']);
  for (const game of games) if (game.algorithm !== 'greedy_partial') game.step = () => { throw new Error('Computed an excluded solver'); };
  const frames = [structuredClone(group.activeGames[0])];
  while (group.advance()) frames.push(structuredClone(group.activeGames[0]));
  assert.equal(group.activeGames[0].status, 'won');
  assert.ok(group.games.filter(g => g.algorithm !== 'greedy_partial').every(g => g.moves === 0));
  for (let i = frames.length - 2; i >= 0; i--) { group.stepBack(); assert.deepEqual(group.activeGames[0], frames[i]); }
  for (let i = 1; i < frames.length; i++) { group.advance(); assert.deepEqual(group.activeGames[0], frames[i]); }
});

test('browser benchmark worker runs only its selected algorithms and rejects invalid selections', async () => {
  const messages = [];
  globalThis.self = { postMessage: message => messages.push(message) };
  try {
    await import('../dist/benchmark-worker.js');
    self.onmessage({ data: { side: 4, seed: 42, count: 2, algorithms: ['greedy_partial'] } });
    assert.equal(messages.at(-1).type, 'done');
    const rows = messages.filter(m => m.type === 'progress').flatMap(m => m.rows);
    assert.equal(rows.length, 2);
    assert.ok(rows.every(row => row.algorithm === 'greedy_partial' && row.status === 'won'));
    assert.ok(rows.every(row => row.hybridSwitchActualLength >= 3 && Number.isInteger(row.partialRoutes)));
    for (const algorithms of [[], ['unknown'], ['partial', 'partial']]) {
      messages.length = 0;
      self.onmessage({ data: { side: 4, seed: 42, count: 1, algorithms } });
      assert.equal(messages[0].type, 'error');
    }
  } finally { delete globalThis.self; }
});
