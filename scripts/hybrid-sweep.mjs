import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { SnakeGame } from '../dist/engine.js';

if (!isMainThread) {
  parentPort.on('message', job => {
    const start = performance.now();
    const game = new SnakeGame({ width: job.side, height: job.side, seed: job.seed, algorithm: 'hybrid', hybridThreshold: job.threshold / 100 });
    let result, error;
    try {
      while (game.status === 'running') {
        if (job.maxMs && performance.now() - start >= job.maxMs) { result = 'compute_limit'; break; }
        const food = game.food, before = game.progressMeasure(), certified = game.hybridPhase === 'certified';
        game.step(); game.assertInvariants();
        if (certified && game.food === food && game.status === 'running' && game.progressMeasure() >= before) throw new Error('Certified progress did not decrease.');
      }
    } catch (caught) { result = 'error'; error = caught.stack; }
    parentPort.postMessage({ ...job, status: result ?? game.status, error, moves: game.moves, length: game.body.length, phase: game.hybridPhase, switchLength: game.hybridSwitchActualLength, switchMove: game.hybridSwitchMove, earlyMoves: game.earlyMoves, recoveryMoves: game.hybridRecoveryMoves, greedyReplans: game.greedyReplans, certifiedReplans: game.certifiedReplans, elapsedMs: performance.now() - start });
  });
} else {
  const options = Object.fromEntries(process.argv.slice(2).map(arg => { const [key, ...value] = arg.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
  const count = Number(options.count ?? 100), side = Number(options.side ?? 12), seedStart = Number(options.seed ?? 10000);
  const thresholds = (options.thresholds ?? '25,35,45,55,65,75,85,95,100').split(',').map(Number);
  const concurrency = Number(options.workers ?? 8), maxFailures = Number(options['max-failures'] ?? 0), maxMs = Number(options['max-ms'] ?? 120000);
  if (!Number.isInteger(count) || count < 1 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16 || !Number.isInteger(seedStart) || seedStart < 0 || seedStart > 4294967295 || !Number.isInteger(side) || side < 2 || side % 2 || side > 40 || thresholds.some(t => !Number.isFinite(t) || t < 10 || t > 100) || new Set(thresholds).size !== thresholds.length || maxMs < 0 || maxFailures < 0) throw new Error('Invalid sweep settings.');
  const out = options.out ?? `artifacts/hybrid-sweep-${side}x${side}-${count}-seed-${seedStart}.json`;
  mkdirSync(dirname(out), { recursive: true });
  const hash = createHash('sha256');
  for (const file of ['engine.js', 'hybrid.js', 'certified.js', 'routing.js']) hash.update(readFileSync(new URL(`../dist/${file}`, import.meta.url)));
  const sourceHash = hash.digest('hex');
  const resumeFiles = options.resume ? options.resume.split(',') : [];
  const retained = new Map();
  for (const file of resumeFiles) {
    const previous = JSON.parse(readFileSync(file, 'utf8'));
    if (previous.sourceHash !== sourceHash || previous.settings.side !== side) throw new Error('Resume requires the same engine source and board size.');
    for (const row of previous.rows) if (thresholds.includes(row.threshold) && ((row.seed - seedStart) >>> 0) < count && ['won', 'failed', 'timeout'].includes(row.status)) retained.set(`${row.threshold}/${row.seed}`, row);
  }
  const rows = [...retained.values()], groups = thresholds.map(threshold => {
    const pending = Array.from({ length: count }, (_, i) => (seedStart + i) >>> 0).filter(seed => !retained.has(`${threshold}/${seed}`));
    return { threshold, pending, sent: count - pending.length, nonwins: rows.filter(row => row.threshold === threshold && row.status !== 'won').length };
  });
  const startedAt = new Date().toISOString();
  const summary = () => groups.map(group => {
    const results = rows.filter(row => row.threshold === group.threshold), wins = results.filter(row => row.status === 'won');
    const moves = wins.map(row => row.moves).sort((a, b) => a - b);
    const switches = results.filter(row => row.switchLength !== null).map(row => row.switchLength / (side * side) * 100).sort((a, b) => a - b);
    const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { threshold: group.threshold, attempted: results.length, wins: wins.length, failures: results.filter(r => r.status === 'failed').length, moveTimeouts: results.filter(r => r.status === 'timeout').length, computeLimits: results.filter(r => r.status === 'compute_limit').length, errors: results.filter(r => r.status === 'error').length, meanMoves: mean(moves), p95Moves: moves[Math.ceil(moves.length * .95) - 1] ?? null, meanMs: mean(results.map(r => r.elapsedMs)), medianActualSwitchPct: switches[Math.floor(switches.length / 2)] ?? null, maxActualSwitchPct: switches.at(-1) ?? null, stoppedEarly: Boolean(maxFailures && group.nonwins >= maxFailures && group.sent < count), examples: results.filter(r => r.status !== 'won').slice(0, 5).map(r => ({ seed: r.seed, status: r.status, moves: r.moves, length: r.length, phase: r.phase })) };
  });
  const save = complete => writeFileSync(out, JSON.stringify({ version: 1, sourceHash, startedAt, updatedAt: new Date().toISOString(), complete, verifyEveryMove: true, resumeFiles, settings: { count, side, seedStart, thresholds, concurrency, maxFailures, maxMs }, summary: summary(), rows }, null, 2));
  let nextGroup = 0, active = 0, terminated = 0, abort = false;
  const workers = [];
  const dispatch = worker => {
    if (!abort) for (let tries = 0; tries < groups.length; tries++) {
      const group = groups[nextGroup++ % groups.length];
      if (group.sent >= count || (maxFailures && group.nonwins >= maxFailures)) continue;
      active++;
      group.sent++;
      worker.postMessage({ side, threshold: group.threshold, seed: group.pending.shift(), maxMs });
      return;
    }
    worker.terminate(); terminated++;
    if (terminated === workers.length) {
      save(true);
      console.table(summary().map(({ threshold, attempted, wins, failures, moveTimeouts, computeLimits, meanMoves }) => ({ threshold, attempted, wins, failures, moveTimeouts, computeLimits, meanMoves })));
      console.log(`Saved ${out}`);
    }
  };
  save(false);
  process.on('SIGINT', () => { save(false); for (const worker of workers) worker.terminate(); process.exit(130); });
  for (let i = 0; i < concurrency; i++) workers.push(new Worker(new URL(import.meta.url)));
  for (const worker of workers) {
    worker.on('message', row => {
      active--; rows.push(row);
      if (row.status !== 'won') groups.find(group => group.threshold === row.threshold).nonwins++;
      if (row.status === 'error') { abort = true; process.exitCode = 1; console.error(row.error); }
      if (rows.length < 10 || rows.length % 10 === 0 || row.status !== 'won') {
        save(false);
        console.log(`${rows.length} finished, ${active} active · ` + summary().map(s => `${s.threshold}% ${s.wins}/${s.attempted}${s.computeLimits ? ` (${s.computeLimits} compute-limited)` : ''}`).join(' · '));
      }
      dispatch(worker);
    });
    worker.on('error', error => { abort = true; process.exitCode = 1; console.error(error); save(false); for (const other of workers) other.terminate(); });
    dispatch(worker);
  }
}
