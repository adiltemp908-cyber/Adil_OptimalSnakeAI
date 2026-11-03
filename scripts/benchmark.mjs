import { writeFileSync, mkdirSync } from 'node:fs';
import { SnakeGame, ALGORITHMS, finishGame, summarize } from '../dist/engine.js';
const thresholdArg = process.argv.find(arg => arg.startsWith('--hybrid-threshold='));
const hybridThreshold = thresholdArg ? Number(thresholdArg.split('=')[1]) : 0.25;
const args = process.argv.slice(2).filter(arg => arg !== '--verify' && !arg.startsWith('--hybrid-threshold='));
const games = Number(args[0] ?? 100);
const side = Number(args[1] ?? 12);
const seedStart = Number(args[2] ?? 0);
const algorithms = args[3] ? args[3].split(',') : ALGORITHMS;
const verify = process.argv.includes('--verify');
if (!Number.isInteger(games) || games < 1 || games > 10000) throw new Error('Games must be 1–10000.');
if (!Number.isInteger(seedStart) || seedStart < 0 || seedStart > 4294967295) throw new Error('Seed must be an unsigned 32-bit integer.');
if (!algorithms.length || new Set(algorithms).size !== algorithms.length || algorithms.some(a => !ALGORITHMS.includes(a))) throw new Error('Select valid, unique algorithm IDs.');
const rows = [];
for (let index = 0; index < games; index++) for (const algorithm of algorithms) {
  const seed = (seedStart + index) >>> 0;
  const start = performance.now();
  const game = finishGame(new SnakeGame({ width: side, height: side, seed, algorithm, hybridThreshold }), verify);
  rows.push({ algorithm, width: side, height: side, seed, status: game.status, moves: game.moves, shortcuts: game.shortcuts, repairs: game.repairs, elapsedMs: performance.now() - start, greedyReplans: game.greedyReplans, certifiedReplans: game.certifiedReplans });
  if (['partial', 'greedy_partial'].includes(algorithm)) for (const key of ['partialRoutes', 'partialReplans', 'partialSplits', 'partialMerges', 'partialRecoveryMoves']) rows.at(-1)[key] = game[key];
  if (['hybrid', 'greedy_partial'].includes(algorithm)) for (const key of ['hybridThreshold', 'hybridSwitchLength', 'hybridSwitchActualLength', 'hybridSwitchMove', 'earlyMoves', 'hybridRecoveryMoves']) rows.at(-1)[key] = game[key];
}
const report = { version: 4, gamesPerAlgorithm: games, board: [side, side], seedStart, verify, algorithms, hybridThreshold, summary: summarize(rows).filter(s => s.games), rows };
mkdirSync('artifacts', { recursive: true });
const path = `artifacts/benchmark-${side}x${side}-${games}-seed-${seedStart}-${algorithms.join('-')}${algorithms.some(id => ['hybrid', 'greedy_partial'].includes(id)) ? `-${Math.round(hybridThreshold * 100)}pct` : ''}${verify ? '-verified' : ''}.json`;
writeFileSync(path, JSON.stringify(report, null, 2));
console.table(report.summary);
console.log(`Saved ${path}`);
