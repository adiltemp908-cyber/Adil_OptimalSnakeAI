import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { SnakeGame, finishGame } from '../dist/engine.js';

if (!isMainThread) {
  parentPort.on('message', job => {
    const start = performance.now();
    try {
      const game = finishGame(new SnakeGame({ width: job.side, height: job.side, seed: job.seed, algorithm: job.algorithm, partialCutPenalty: job.penalty }), true);
      parentPort.postMessage({ ...job, status: game.status, moves: game.moves, length: game.body.length, partialSplits: game.partialSplits, partialMerges: game.partialMerges, recoveryMoves: game.partialRecoveryMoves, partialRoutes: game.partialRoutes, partialReplans: game.partialReplans, elapsedMs: performance.now() - start });
    } catch (error) { parentPort.postMessage({ ...job, status: 'error', error: error.stack }); }
  });
} else {
  const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split('=')));
  const count = Number(options.count ?? 100), side = Number(options.side ?? 12), seedStart = Number(options.seed ?? 40000), workers = Number(options.workers ?? 4);
  const penalties = (options.penalties ?? '4').split(',').map(Number), algorithms = (options.algorithms ?? 'partial').split(',');
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(side) || side < 2 || side % 2 || !Number.isInteger(workers) || workers < 1 || workers > 16 || penalties.some(p => !Number.isFinite(p) || p < 0)) throw new Error('Invalid study settings.');
  const jobs = [], rows = [], pool = [];
  for (let i = 0; i < count; i++) for (const algorithm of algorithms) for (const penalty of ['partial', 'greedy_partial'].includes(algorithm) ? penalties : [1]) jobs.push({ side, seed: (seedStart + i) >>> 0, algorithm, penalty });
  const source = createHash('sha256');
  for (const name of ['engine.js', 'partial.js', 'hybrid.js', 'routing.js', 'certified.js']) source.update(readFileSync(new URL(`../dist/${name}`, import.meta.url)));
  const sourceHash = source.digest('hex'), out = options.out ?? `artifacts/partial-${side}x${side}-${count}-seed${seedStart}.json`;
  mkdirSync(dirname(out), { recursive: true });
  const summary = () => [...new Set(rows.map(r => `${r.algorithm}/${r.penalty}`))].sort().map(key => {
    const list = rows.filter(r => `${r.algorithm}/${r.penalty}` === key), wins = list.filter(r => r.status === 'won');
    const mean = field => wins.length ? wins.reduce((sum, r) => sum + r[field], 0) / wins.length : null;
    return { algorithm: list[0].algorithm, penalty: list[0].penalty, games: list.length, wins: wins.length, meanMoves: mean('moves'), meanSplits: mean('partialSplits'), meanRecovery: mean('recoveryMoves'), meanMs: mean('elapsedMs') };
  });
  const save = complete => writeFileSync(out, JSON.stringify({ complete, sourceHash, verifyEveryMove: true, settings: { count, side, seedStart, workers, penalties, algorithms }, summary: summary(), rows }, null, 2));
  let next = 0, ended = 0, aborted = false;
  const dispatch = worker => {
    if (!aborted && next < jobs.length) worker.postMessage(jobs[next++]);
    else {
      worker.terminate(); ended++;
      if (ended === pool.length) { save(!aborted); console.table(summary()); console.log(out); }
    }
  };
  for (let i = 0; i < workers; i++) pool.push(new Worker(new URL(import.meta.url)));
  for (const worker of pool) {
    worker.on('message', row => {
      rows.push(row);
      if (row.status === 'error') { aborted = true; process.exitCode = 1; console.error(row.error); }
      if (rows.length % 25 === 0) { save(false); console.log(`${rows.length}/${jobs.length} verified`); }
      dispatch(worker);
    });
    worker.on('error', error => { aborted = true; process.exitCode = 1; console.error(error); save(false); for (const w of pool) w.terminate(); });
    dispatch(worker);
  }
  process.on('SIGINT', () => { save(false); for (const w of pool) w.terminate(); process.exit(130); });
}
