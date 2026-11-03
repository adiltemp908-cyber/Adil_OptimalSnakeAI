import assert from 'node:assert/strict';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SnakeGame } from '../dist/engine.js';

// Reuse the existing greedy policy for the whole game. A target above board
// capacity prevents every handoff/certificate branch, including the final meal.
if (!isMainThread) {
  parentPort.on('message', ({ side, seed }) => {
    const game = new SnakeGame({ width: side, height: side, seed, algorithm: 'hybrid' });
    game.hybridSwitchLength = game.size + 1;
    const started = performance.now();
    let lastProgress = started;
    game.assertInvariants();
    while (game.status === 'running') {
      game.step();
      game.assertInvariants();
      assert.equal(game.hybridPhase, 'greedy');
      assert.equal(game.hybridSwitchMove, null);
      assert.equal(game.certifiedMoves, 0);
      assert.equal(game.repairs, 0);
      if (performance.now() - lastProgress > 15000) {
        parentPort.postMessage({ progress: true, seed, moves: game.moves, length: game.body.length });
        lastProgress = performance.now();
      }
    }
    parentPort.postMessage({ seed, status: game.status, moves: game.moves,
      length: game.body.length, recoveryMoves: game.hybridRecoveryMoves,
      greedyReplans: game.greedyReplans, switchMove: game.hybridSwitchMove,
      lastAction: game.lastAction, lastFoodMove: game.history.at(-1)[0],
      elapsedMs: performance.now() - started });
  });
} else {
  const count = Number(process.argv[2] ?? 100);
  const side = Number(process.argv[3] ?? 12);
  const seedStart = Number(process.argv[4] ?? 0);
  const concurrency = Number(process.argv[5] ?? 4);
  assert.ok(Number.isInteger(count) && count > 0 && count <= 10000);
  assert.ok(Number.isInteger(side) && side >= 2 && side <= 40 && side % 2 === 0);
  assert.ok(Number.isInteger(seedStart) && seedStart >= 0 && seedStart + count - 1 <= 0xffffffff);
  assert.ok(Number.isInteger(concurrency) && concurrency > 0 && concurrency <= 16);
  const sourceHashes = {};
  for (const file of ['../dist/engine.js', '../dist/hybrid.js', '../dist/routing.js', '../dist/certified.js', '../dist/partial.js', './pure-greedy-study.mjs']) {
    sourceHashes[file] = createHash('sha256').update(readFileSync(new URL(file, import.meta.url))).digest('hex');
  }
  const rows = [], startedAt = new Date().toISOString(), started = performance.now();
  const output = new URL(`../artifacts/pure-greedy-${side}x${side}-${count}-seed-${seedStart}.json`, import.meta.url);
  mkdirSync(new URL('../artifacts/', import.meta.url), { recursive: true });
  if (process.argv.includes('--resume') && existsSync(output)) {
    const previous = JSON.parse(readFileSync(output, 'utf8'));
    for (const [file, hash] of Object.entries(sourceHashes)) {
      if (file.startsWith('../dist/')) assert.equal(previous.sourceHashes[file], hash, `Changed policy: ${file}`);
    }
    assert.equal(previous.settings.count, count);
    assert.equal(previous.settings.side, side);
    assert.equal(previous.settings.seedStart, seedStart);
    rows.push(...previous.rows);
  }
  const completedSeeds = new Set(rows.map(row => row.seed));
  const pendingSeeds = Array.from({ length: count }, (_, index) => seedStart + index).filter(seed => !completedSeeds.has(seed));
  const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const summary = () => {
    const winners = rows.filter(row => row.status === 'won');
    const moves = winners.map(row => row.moves).sort((a, b) => a - b);
    return {
      games: rows.length, wins: winners.length,
      timeouts: rows.filter(row => row.status === 'timeout').length,
      failures: rows.filter(row => row.status === 'failed').length,
      meanWinningMoves: mean(moves),
      medianWinningMoves: moves.length ? (moves[Math.floor((moves.length - 1) / 2)] + moves[Math.floor(moves.length / 2)]) / 2 : null,
      minWinningMoves: moves[0] ?? null, maxWinningMoves: moves.at(-1) ?? null,
      meanMovesAllRuns: mean(rows.map(row => row.moves)),
      meanFinalLength: mean(rows.map(row => row.length)),
      meanFinalOccupancyPct: mean(rows.map(row => 100 * row.length / (side * side))),
    };
  };
  const save = complete => writeFileSync(output, JSON.stringify({
    version: 1, complete, startedAt, updatedAt: new Date().toISOString(),
    elapsedMs: performance.now() - started, sourceHashes,
    settings: { count, side, seedStart, concurrency, initialLength: 3,
      verifyEveryMove: true, handoffEnabled: false,
      moveLimit: (side * side - 3) * (side * side - 1), wallClockLimit: null,
      policy: 'Existing greedy phase: bounded moving-body food search, exact route simulation, post-food tail access, exit-cost tie breaking, tail-path recovery and repeated-state penalties.' },
    summary: summary(), rows: [...rows].sort((a, b) => a.seed - b.seed),
  }, null, 2));
  let next = 0;
  const workers = [];
  const dispatch = worker => {
    if (next < pendingSeeds.length) worker.postMessage({ side, seed: pendingSeeds[next++] });
    else worker.terminate();
  };
  save(rows.length === count);
  if (!pendingSeeds.length) console.table(summary());
  for (let index = 0; index < Math.min(pendingSeeds.length, concurrency); index++) {
    const worker = new Worker(new URL(import.meta.url));
    workers.push(worker);
    worker.on('message', row => {
      if (row.progress) {
        console.log(`In progress: seed ${row.seed}, ${row.moves} moves, length ${row.length}/${side * side}`);
        return;
      }
      rows.push(row);
      save(rows.length === count);
      console.log(`${rows.length}/${count}: seed ${row.seed}, ${row.status}, ${row.moves} moves, length ${row.length}/${side * side}`);
      if (rows.length === count) {
        console.table(summary());
        console.log(`Saved ${output.pathname}`);
      }
      dispatch(worker);
    });
    worker.on('error', error => {
      console.error(error);
      save(false);
      process.exitCode = 1;
      for (const active of workers) active.terminate();
    });
    dispatch(worker);
  }
}
