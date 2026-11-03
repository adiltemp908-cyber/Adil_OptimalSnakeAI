import { SnakeGame, ALGORITHMS, finishGame } from './engine.js';
import { validSquareSide } from './board-size.js';
self.onmessage = ({ data }) => {
  const { side, seed, count, hybridThreshold = 0.25, algorithms = ALGORITHMS } = data;
  if (!Array.isArray(algorithms) || !algorithms.length || new Set(algorithms).size !== algorithms.length || algorithms.some(id => !ALGORITHMS.includes(id)) || !validSquareSide(side) || !Number.isInteger(count) || count < 1 || count > 250) {
    self.postMessage({ type: 'error', message: 'Invalid benchmark settings.' });
    return;
  }
  try {
    for (let index = 0; index < count; index++) {
      const rows = [];
      for (const algorithm of algorithms) {
        self.postMessage({ type: 'working', algorithm, seed: (seed + index) >>> 0, index });
        const start = performance.now();
        const game = finishGame(new SnakeGame({ width: side, height: side, seed: (seed + index) >>> 0, algorithm, hybridThreshold }));
        rows.push({ algorithm, width: side, height: side, seed: game.seed, status: game.status, moves: game.moves, shortcuts: game.shortcuts, repairs: game.repairs, elapsedMs: performance.now() - start, greedyReplans: game.greedyReplans, certifiedReplans: game.certifiedReplans });
        if (['partial', 'greedy_partial'].includes(algorithm)) for (const key of ['partialRoutes', 'partialReplans', 'partialSplits', 'partialMerges', 'partialRecoveryMoves']) rows.at(-1)[key] = game[key];
        if (['hybrid', 'greedy_partial'].includes(algorithm)) for (const key of ['hybridThreshold', 'hybridSwitchLength', 'hybridSwitchActualLength', 'hybridSwitchMove', 'earlyMoves', 'hybridRecoveryMoves']) rows.at(-1)[key] = game[key];
      }
      self.postMessage({ type: 'progress', completed: index + 1, rows });
    }
    self.postMessage({ type: 'done' });
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
