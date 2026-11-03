// Keep the simulation at its furthest computed tick; rewind a separate view.
// Replaying saved ticks never consumes randomness or repeats expensive search.
// Body/history changes are deltas, not full board copies for every move.
const fields = ['moves', 'foods', 'shortcuts', 'repairs', 'skipped', 'status', 'food', 'lastAction', 'certifiedRoutes', 'certifiedMoves', 'cycle', 'hybridPhase', 'hybridSwitchMove', 'hybridSwitchActualLength', 'earlyRoutes', 'earlyMoves', 'hybridRecoveryMoves', 'greedyReplans', 'certifiedReplans', 'partialLoop', 'partialParents', 'partialRoutes', 'partialReplans', 'partialSplits', 'partialMerges', 'partialRecoveryMoves'];
function metadata(game) {
  const state = Object.fromEntries(fields.map(key => [key, game[key]]));
  // Paths and cycles are immutable after construction; only the cursor mutates.
  state.activePlan = game.activePlan ? { ...game.activePlan } : null;
  return state;
}

export class PlaybackTimeline {
  constructor(liveGames) {
    this.liveGames = liveGames;
    this.frames = [];
    this.cursor = 0;
    this.latest = liveGames.map(metadata);
    this.games = liveGames.map((game, i) => ({
      width: game.width, height: game.height, size: game.size, seed: game.seed, algorithm: game.algorithm,
      hybridThreshold: game.hybridThreshold, hybridSwitchLength: game.hybridSwitchLength,
      body: [...game.body], history: game.history.map(point => [...point]), ...this.latest[i],
    }));
  }

  get canStepBack() { return this.cursor > 0; }

  advance() {
    if (this.cursor === this.frames.length) {
      if (this.liveGames.every(game => game.status !== 'running')) return false;
      const frame = this.liveGames.map((game, i) => {
        if (game.status !== 'running') return null;
        const before = this.latest[i], tail = game.body.at(-1), length = game.body.length;
        game.step();
        const after = metadata(game);
        this.latest[i] = after;
        return { before, after, tail, head: game.body[0], moved: after.moves > before.moves, grew: game.body.length > length };
      });
      this.frames.push(frame);
    }
    this.apply(this.frames[this.cursor++], true);
    return true;
  }

  stepBack() {
    if (!this.canStepBack) return false;
    this.apply(this.frames[--this.cursor], false);
    return true;
  }

  apply(frame, forward) {
    frame.forEach((change, i) => {
      if (!change) return;
      const view = this.games[i];
      if (change.moved) {
        if (forward) {
          if (!change.grew) view.body.pop();
          view.body.unshift(change.head);
          if (change.grew) view.history.push([change.after.moves, view.body.length]);
        } else {
          view.body.shift();
          if (!change.grew) view.body.push(change.tail);
          if (change.grew) view.history.pop();
        }
      }
      Object.assign(view, forward ? change.after : change.before);
    });
  }
}

// Each algorithm owns its history, so focusing or hiding a board never moves
// another board or discards its recorded decisions and random state.
export class PlaybackGroup {
  constructor(liveGames) {
    this.timelines = new Map(liveGames.map(game => [game.algorithm, new PlaybackTimeline([game])]));
    this.select([...this.timelines.keys()]);
  }

  select(algorithms) {
    if (!algorithms.length || new Set(algorithms).size !== algorithms.length || algorithms.some(id => !this.timelines.has(id))) throw new Error('Select existing, unique algorithms.');
    this.selected = [...algorithms];
  }

  get games() { return [...this.timelines.values()].map(timeline => timeline.games[0]); }
  get activeGames() { return this.selected.map(id => this.timelines.get(id).games[0]); }
  get canStepBack() { return this.selected.some(id => this.timelines.get(id).canStepBack); }

  advance() {
    let changed = false;
    for (const id of this.selected) changed = this.timelines.get(id).advance() || changed;
    return changed;
  }

  stepBack() {
    let changed = false;
    for (const id of this.selected) changed = this.timelines.get(id).stepBack() || changed;
    return changed;
  }

  replace(game) {
    if (!this.timelines.has(game.algorithm)) throw new Error('Cannot replace an unknown algorithm.');
    this.timelines.set(game.algorithm, new PlaybackTimeline([game]));
  }
}
