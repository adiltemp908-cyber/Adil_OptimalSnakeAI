import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, finishGame } from '../dist/engine.js';
import { certifies } from '../dist/lanekeeper.js';

test('lanekeeper wins even and odd-sided boards with every-move checks', () => {
  for (const [width, height, seed] of [[2, 2, 0], [2, 7, 7], [7, 2, 6], [4, 3, 35], [4, 4, 18], [6, 6, 3], [8, 8, 3], [10, 7, 1]]) {
    const game = finishGame(new SnakeGame({ algorithm: 'lanekeeper', width, height, seed }), true);
    assert.equal(game.status, 'won', `${width}x${height}, seed ${seed}`);
    assert.equal(game.body.length, width * height);
  }
});

test('the live cycle certifies the body after every move and a corrupted cycle is rejected', () => {
  const game = new SnakeGame({ algorithm: 'lanekeeper', width: 8, height: 8, seed: 42 });
  while (game.status === 'running') {
    game.step();
    if (game.status !== 'running' || game.activePlan) continue;
    const start = game.positions[game.body[0]];
    const cycle = [...game.cycle.slice(start), ...game.cycle.slice(0, start)];
    assert.ok(certifies(game, cycle, game.body), `move ${game.moves}`);
    const broken = [...cycle];
    [broken[1], broken[2]] = [broken[2], broken[1]];
    assert.equal(certifies(game, broken, game.body), false);
  }
  assert.equal(game.status, 'won');
});

test('planning never draws from the food random stream', () => {
  const game = new SnakeGame({ algorithm: 'lanekeeper', width: 8, height: 8, seed: 7 });
  const draw = game.random;
  let draws = 0, foods = 1;
  game.random = () => { draws++; return draw(); };
  while (game.status === 'running') {
    const food = game.food;
    game.step();
    if (game.status === 'running' && game.food !== food) foods++;
  }
  assert.equal(game.status, 'won');
  assert.equal(draws, foods - 1);
});

test('the move budget covers the per-food progress bound', () => {
  const game = new SnakeGame({ algorithm: 'lanekeeper', width: 12, height: 12 });
  assert.equal(game.moveLimit, (144 - 3) * (2 * 144 - 1));
});
