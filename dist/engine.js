// Pure simulation: shared by the browser, worker, tests, and CLI benchmarks.
import { findCertifiedRoute, validatePlan } from './certified.js';
import { chooseHybridMove, validateHybridPlan, inspectSpace } from './hybrid.js';
import { choosePartialMove, validatePartialState, validatePartialPlan } from './partial.js';
import { chooseLanekeeperMove, lanekeeperProgress } from './lanekeeper.js';
export const ALGORITHMS = ['cycle', 'shortcut', 'repair', 'compact', 'certified', 'hybrid', 'partial', 'greedy_partial', 'lanekeeper'];
export const LABELS = { cycle: 'Hamiltonian cycle', shortcut: 'Safe shortcuts', repair: 'Dynamic repair', compact: 'Compact planner', certified: 'Certified routes', hybrid: 'Greedy → certified', partial: 'Adaptive partial loops', greedy_partial: 'Greedy → partial loops', lanekeeper: 'Lanekeeper' };
export const mod = (n, m) => ((n % m) + m) % m;

export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function adjacent(a, b, width) {
  return Math.abs(a % width - b % width) + Math.abs(Math.floor(a / width) - Math.floor(b / width)) === 1;
}

export function makeCycle(width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || (width % 2 && height % 2)) {
    throw new Error('Use a rectangle of at least 2 × 2 with at least one even dimension.');
  }
  // Reserve column zero for closing the loop; sweep the remaining columns.
  const transpose = height % 2 !== 0;
  const w = transpose ? height : width;
  const h = transpose ? width : height;
  const cycle = [];
  const add = (x, y) => cycle.push(transpose ? x * width + y : y * width + x);
  add(0, 0);
  for (let y = 0; y < h; y++) {
    if (y % 2 === 0) for (let x = 1; x < w; x++) add(x, y);
    else for (let x = w - 1; x >= 1; x--) add(x, y);
  }
  for (let y = h - 1; y > 0; y--) add(0, y);
  return cycle;
}

export function cyclePositions(cycle) {
  const positions = new Int32Array(cycle.length);
  cycle.forEach((cell, index) => { positions[cell] = index; });
  return positions;
}

export function bodyOrdered(body, positions, size) {
  let previous = size;
  for (let i = 1; i < body.length; i++) {
    const distance = mod(positions[body[i]] - positions[body[0]], size);
    if (distance <= 0 || distance >= previous) return false;
    previous = distance;
  }
  return true;
}

function squaresFor(width, height) {
  const squares = [];
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const a = y * width + x;
    squares.push([a, a + 1, a + width + 1, a + width]);
  }
  return squares;
}

function cycleGraph(cycle) {
  const graph = Array.from({ length: cycle.length }, () => []);
  cycle.forEach((v, i) => { graph[v] = [cycle[mod(i - 1, cycle.length)], cycle[(i + 1) % cycle.length]]; });
  return graph;
}

function flipEdges(graph, square) {
  const [a, b, c, d] = square;
  const has = (u, v) => graph[u].includes(v);
  if (has(a, b) && has(c, d) && !has(a, d) && !has(b, c)) return [[a, b, c, d]];
  if (has(a, d) && has(b, c) && !has(a, b) && !has(c, d)) return [[a, d, c, b]];
  return [];
}

function switchEdges(graph, [a, b, c, d]) {
  graph[a][graph[a].indexOf(b)] = d;
  graph[b][graph[b].indexOf(a)] = c;
  graph[c][graph[c].indexOf(d)] = b;
  graph[d][graph[d].indexOf(c)] = a;
}

function undoEdges(graph, [a, b, c, d]) { switchEdges(graph, [a, d, c, b]); }

function walkLoop(graph, start, next = graph[start][0]) {
  const loop = [start];
  let previous = start;
  let current = next;
  while (current !== start && loop.length <= graph.length) {
    loop.push(current);
    const following = graph[current][0] === previous ? graph[current][1] : graph[current][0];
    previous = current;
    current = following;
  }
  return loop;
}

// Most rewires cannot beat the current food distance. Measure just the needed
// prefix before allocating a complete candidate cycle. The second square flip
// joins the two components, so its graph is already known to be one full loop.
function loopDistance(graph, start, target, next, limit = graph.length) {
  let previous = start, current = next;
  for (let distance = 1; distance < limit; distance++) {
    if (current === target) return distance;
    const following = graph[current][0] === previous ? graph[current][1] : graph[current][0];
    previous = current; current = following;
  }
  return Infinity;
}

// Rewire only the unoccupied part of a cycle. Every actual body edge is locked.
// Unlike order-only repair this cannot strand empty cells between body segments.
export function repairCompactCycle(game, iterations = 0) {
  const { size, body, food, squares } = game;
  if (food === null) return false;
  if (body.length < 2 || game.distance(body[0], body.at(-1)) !== size - body.length + 1) return false;
  const graph = cycleGraph(game.cycle);
  const rank = new Int32Array(size).fill(-1);
  body.forEach((cell, i) => { rank[cell] = i; });
  const unlocked = ([a, b, c, d]) => !((rank[a] >= 0 && rank[b] >= 0 && Math.abs(rank[a] - rank[b]) === 1) || (rank[c] >= 0 && rank[d] >= 0 && Math.abs(rank[c] - rank[d]) === 1));
  const flips = () => squares.map(s => flipEdges(graph, s)[0]).filter(e => e && unlocked(e));
  const head = body[0], neck = body[1];
  const orientedLoop = () => walkLoop(graph, head, graph[head].find(v => v !== neck));
  let bestCycle = null, bestDistance = game.distance(head, food), currentDistance = bestDistance;
  const initialDistance = bestDistance;
  const lowerBound = Math.abs(head % game.width - food % game.width) + Math.abs(Math.floor(head / game.width) - Math.floor(food / game.width));
  if (bestDistance === lowerBound) return false;
  // After an exhaustive unsuccessful repair, one ordinary move only unlocks
  // the old tail edge and locks the new head edge. An improving pair that does
  // not remove the newly unlocked edge was already available and rejected.
  // Preserve enumeration order while checking only those newly possible pairs.
  const old = game.compactExhausted;
  const released = !iterations && old?.cycle === game.cycle && old.moves + 1 === game.moves && old.food === food && old.length === body.length && old.head === body[1] && old.penultimate === body.at(-1) ? [old.tail, old.penultimate] : null;
  const removesReleased = e => released && ((e[0] === released[0] && e[1] === released[1]) || (e[1] === released[0] && e[0] === released[1]) || (e[2] === released[0] && e[3] === released[1]) || (e[3] === released[0] && e[2] === released[1]));
  const releasedSquares = released ? squares.filter(s => s.includes(released[0]) && s.includes(released[1])) : null;
  if (!game.plannerRandom) game.plannerRandom = seededRandom(game.seed ^ 0xa53c9e21);
  const firsts = flips();
  for (let k = 0; k < (iterations || firsts.length); k++) {
    const choices = iterations ? flips() : firsts;
    if (!choices.length) break;
    const first = choices[iterations ? Math.floor(game.plannerRandom() * choices.length) : k];
    switchEdges(graph, first);
    const restricted = released && !removesReleased(first);
    const secondChoices = restricted ? releasedSquares.map(s => flipEdges(graph, s)[0]).filter(e => e && unlocked(e) && removesReleased(e)) : null;
    if (restricted && !secondChoices.length) { undoEdges(graph, first); continue; }
    const loop = walkLoop(graph, head);
    if (loop.length === size) { undoEdges(graph, first); continue; }
    const component = new Uint8Array(size);
    for (const cell of loop) component[cell] = 1;
    const seconds = (secondChoices ?? flips()).filter(e => component[e[0]] !== component[e[2]] && !e.every(cell => first.includes(cell)));
    let accepted = false;
    const attempts = iterations && seconds.length ? [seconds[Math.floor(game.plannerRandom() * seconds.length)]] : seconds;
    for (const second of attempts) {
      switchEdges(graph, second);
      const distance = loopDistance(graph, head, food, graph[head].find(v => v !== neck), iterations ? size : bestDistance);
      if (distance < bestDistance) {
        bestCycle = orientedLoop(); bestDistance = distance;
      }
      // Annealing explores neutral/slightly worse routes internally. Only the
      // best strictly improving cycle is ever returned to the live game.
      const temperature = 1 + 5 * (1 - k / Math.max(1, iterations));
      if (iterations && (distance <= currentDistance || game.plannerRandom() < Math.exp((currentDistance - distance) / temperature))) {
        currentDistance = distance; accepted = true; break;
      }
      undoEdges(graph, second);
    }
    if (!accepted) undoEdges(graph, first);
    if (bestDistance === lowerBound) break;
  }
  if (!bestCycle || bestDistance >= initialDistance) {
    if (!iterations) game.compactExhausted = { cycle: game.cycle, moves: game.moves, food, length: body.length, head, tail: body.at(-1), penultimate: body.at(-2) };
    return false;
  }
  game.cycle = bestCycle; game.positions = cyclePositions(bestCycle); game.repairs++;
  return true;
}

// A square flip usually splits one Hamiltonian cycle into two loops. A second
// flip joins the loops differently. Accept only a complete cycle, correctly
// ordered body, and strictly shorter forward distance to the current food.
// Bounded first-flip candidates keep the interactive solver responsive.
export function repairCycle(game, splitBudget = 48) {
  const { size, body, food, squares } = game;
  if (food === null) return false;
  const lowerBound = Math.abs(body[0] % game.width - food % game.width) + Math.abs(Math.floor(body[0] / game.width) - Math.floor(food / game.width));
  if (game.distance(body[0], food) === lowerBound) return false;
  const graph = cycleGraph(game.cycle);
  let bestCycle = null;
  let bestDistance = game.distance(body[0], food);
  let examined = 0;
  const candidates = squares.filter(s => flipEdges(graph, s).length);
  // Rotate the exploration order per apple; deterministic, independent of RNG.
  const offset = (game.foods * 17) % Math.max(1, candidates.length);
  for (let k = 0; k < candidates.length && examined < splitBudget; k++) {
    const first = flipEdges(graph, candidates[(k + offset) % candidates.length])[0];
    if (!first) continue;
    examined++;
    switchEdges(graph, first);
    const loop = walkLoop(graph, body[0]);
    if (loop.length < size) {
      const component = new Uint8Array(size);
      for (const cell of loop) component[cell] = 1;
      for (const square of squares) {
        const second = flipEdges(graph, square)[0];
        if (!second || component[second[0]] === component[second[2]]) continue;
        switchEdges(graph, second);
        const forwardDistance = loopDistance(graph, body[0], food, graph[body[0]][0]);
        if (forwardDistance >= bestDistance && size - forwardDistance >= bestDistance) {
          undoEdges(graph, second);
          continue;
        }
        const candidate = walkLoop(graph, body[0]);
        if (candidate.length === size) {
          for (let direction = 0; direction < 2; direction++) {
            const oriented = direction === 0 ? candidate : [candidate[0], ...candidate.slice(1).reverse()];
            const distance = oriented.indexOf(food);
            if (distance < bestDistance) {
              const positions = cyclePositions(oriented);
              if (bodyOrdered(body, positions, size)) {
                bestDistance = distance;
                bestCycle = oriented;
              }
            }
          }
        }
        undoEdges(graph, second);
      }
    }
    undoEdges(graph, first);
  }
  if (!bestCycle) return false;
  game.cycle = bestCycle;
  game.positions = cyclePositions(bestCycle);
  game.repairs++;
  return true;
}

export class SnakeGame {
  constructor({ width = 12, height = 12, seed = 42, algorithm = 'cycle', hybridThreshold = 0.25, partialCutPenalty = 4 } = {}) {
    if (!ALGORITHMS.includes(algorithm)) throw new Error('Unknown algorithm.');
    if (width * height > 1600) throw new Error('Maximum board size is 1600 cells.');
    this.width = width;
    this.height = height;
    this.size = width * height;
    this.seed = seed >>> 0;
    this.algorithm = algorithm;
    this.random = seededRandom(this.seed);
    this.cycle = makeCycle(width, height);
    this.positions = cyclePositions(this.cycle);
    this.squares = squaresFor(width, height);
    this.body = [this.cycle[2], this.cycle[1], this.cycle[0]];
    this.occupied = new Uint8Array(this.size);
    this.body.forEach(cell => { this.occupied[cell] = 1; });
    this.moves = 0;
    this.foods = 0;
    this.shortcuts = 0;
    this.repairs = 0;
    this.skipped = 0;
    this.activePlan = null;
    this.certifiedRoutes = 0;
    this.certifiedMoves = 0;
    this.lastCertificateApple = -1;
    if (!Number.isFinite(hybridThreshold) || hybridThreshold < 0.1 || hybridThreshold > 1) throw new Error('Hybrid threshold must be between 10% and 100%.');
    this.hybridThreshold = hybridThreshold;
    this.hybridSwitchLength = Math.max(4, Math.ceil(this.size * hybridThreshold));
    this.hybridPhase = 'greedy';
    this.hybridSwitchMove = null;
    this.hybridSwitchActualLength = null;
    this.earlyRoutes = 0;
    this.earlyMoves = 0;
    this.hybridRecoveryMoves = 0;
    this.greedyReplans = 0;
    this.certifiedReplans = 0;
    if (!Number.isFinite(partialCutPenalty) || partialCutPenalty < 0) throw new Error('Invalid partial cut penalty.');
    this.partialCutPenalty = partialCutPenalty;
    this.partialLoop = this.cycle; this.partialParents = [];
    this.partialRoutes = 0; this.partialReplans = 0;
    this.partialSplits = 0; this.partialMerges = 0; this.partialRecoveryMoves = 0;
    // Lanekeeper: each food allows `size` free moves, then at most size - 1 moves that strictly close the cycle distance.
    this.moveLimit = algorithm === 'lanekeeper' ? (this.size - 3) * (2 * this.size - 1) : (this.size - 3) * (this.size - 1) * (['partial', 'greedy_partial'].includes(algorithm) ? Math.floor(this.size / 4) : 1);
    this.status = 'running';
    this.lastAction = this.greedyEarly ? 'Seeking a locally checked food route' : 'Following the cycle';
    this.history = [[0, 3]];
    this.spawnFood();
  }

  get greedyEarly() { return ['hybrid', 'greedy_partial'].includes(this.algorithm) && !['certified', 'partial'].includes(this.hybridPhase); }
  get usesPartial() { return this.algorithm === 'partial' || (this.algorithm === 'greedy_partial' && this.hybridPhase === 'partial'); }

  distance(a, b) { return mod(this.positions[b] - this.positions[a], this.size); }

  progressMeasure() {
    if (this.food === null) return 0;
    if (this.algorithm === 'lanekeeper') return lanekeeperProgress(this);
    return this.activePlan ? this.activePlan.path.length - this.activePlan.cursor : this.distance(this.body[0], this.food);
  }

  spawnFood() {
    // One uniform draw per apple, selecting by row-major free-cell rank.
    // Same seed means common random numbers, NOT identical food coordinates:
    // different policies occupy different cells.
    let rank = Math.floor(this.random() * (this.size - this.body.length));
    for (let cell = 0; cell < this.size; cell++) {
      if (!this.occupied[cell] && rank-- === 0) { this.food = cell; break; }
    }
    this.needsRepair = true;
  }

  neighbors(cell) {
    const cells = [];
    const x = cell % this.width, y = Math.floor(cell / this.width);
    if (x > 0) cells.push(cell - 1);
    if (x < this.width - 1) cells.push(cell + 1);
    if (y > 0) cells.push(cell - this.width);
    if (y < this.height - 1) cells.push(cell + this.width);
    return cells;
  }

  chooseMove() {
    if (this.algorithm === 'lanekeeper') return chooseLanekeeperMove(this);
    if (this.usesPartial) return choosePartialMove(this);
    if (this.greedyEarly) return chooseHybridMove(this);
    if (this.algorithm === 'certified' || this.algorithm === 'hybrid') {
      if (this.activePlan) {
        const replacement = findCertifiedRoute(this, 2000, this.activePlan.path.length - this.activePlan.cursor - 1);
        if (replacement) {
          this.activePlan = replacement;
          this.certifiedRoutes++;
          this.certifiedReplans++;
        }
      }
      if (!this.activePlan) {
        this.lastCertificateApple = this.foods;
        this.activePlan = findCertifiedRoute(this);
        if (this.activePlan) this.certifiedRoutes++;
      }
      if (this.activePlan) return this.activePlan.path[this.activePlan.cursor];
    }
    const head = this.body[0];
    const successor = this.cycle[(this.positions[head] + 1) % this.size];
    if (this.algorithm === 'cycle' || this.algorithm === 'compact' || this.algorithm === 'certified' || this.algorithm === 'hybrid') return successor;
    const tail = this.body.at(-1);
    const tailDistance = this.body.length === 1 ? this.size : this.distance(head, tail);
    const foodDistance = this.distance(head, this.food);
    let best = successor;
    let bestAdvance = 1;
    for (const cell of this.neighbors(head)) {
      const grows = cell === this.food;
      if (this.occupied[cell] && !(cell === tail && !grows)) continue;
      const advance = this.distance(head, cell);
      if (advance > bestAdvance && advance <= foodDistance && (advance < tailDistance || (advance === tailDistance && !grows))) {
        best = cell;
        bestAdvance = advance;
      }
    }
    return best;
  }

  step() {
    if (this.status !== 'running') return false;
    if ((['hybrid', 'partial', 'greedy_partial'].includes(this.algorithm) && this.moves >= this.moveLimit) || (this.algorithm === 'greedy_partial' && this.greedyEarly && this.moves >= (this.size - 3) * (this.size - 1))) {
      this.status = 'timeout';
      this.lastAction = this.algorithm === 'partial' ? 'Partial-loop move bound reached' : 'Heuristic move budget reached';
      return false;
    }
    let hybridEarly = this.greedyEarly;
    let repaired = false;
    if (this.algorithm === 'repair') {
      // Tail departure can unlock a repair between meals. Check every move.
      for (let i = 0; i < 2; i++) {
        if (!repairCycle(this)) break;
        repaired = true;
      }
    }
    const partialFull = this.usesPartial && this.partialParents.length === 0;
    if (partialFull) { this.cycle = this.partialLoop; this.positions = cyclePositions(this.cycle); }
    if ((partialFull || this.algorithm === 'compact' || this.algorithm === 'certified' || (this.algorithm === 'hybrid' && !hybridEarly)) && !this.activePlan) {
      // Lock the full body into the cycle, then optimize its empty portion.
      // Revisit the plan as the departing tail unlocks new edges.
      const improve = () => {
        for (let pass = 0; pass < 8; pass++) {
          if (!repairCompactCycle(this)) break;
          repaired = true;
        }
      };
      improve();
      if (this.needsRepair && repairCompactCycle(this, 512)) {
        repaired = true;
        improve();
      }
    }
    if (partialFull) this.partialLoop = this.cycle;
    this.needsRepair = false;
    const replansBefore = this.greedyReplans + this.certifiedReplans + this.partialReplans;
    const next = this.chooseMove();
    hybridEarly = this.greedyEarly;
    if (next === null) {
      this.status = 'failed';
      this.lastAction = 'Heuristic found no safe move';
      return false;
    }
    const followingPlan = this.activePlan !== null;
    const grows = next === this.food;
    const tail = this.body.at(-1);
    if (!adjacent(this.body[0], next, this.width) || (this.occupied[next] && !(next === tail && !grows))) {
      this.status = 'failed';
      this.lastAction = 'Safety check failed';
      return false;
    }
    const advance = this.distance(this.body[0], next);
    if (!this.usesPartial && !hybridEarly && !followingPlan && advance > 1) { this.shortcuts++; this.skipped += advance - 1; }
    if (!this.usesPartial) this.lastAction = hybridEarly ? 'Freeing space near the tail' : repaired ? 'Repaired the cycle' : advance > 1 ? `Shortcut · skipped ${advance - 1} cells` : 'Following the cycle';
    if (!grows) { this.occupied[this.body.pop()] = 0; }
    this.body.unshift(next);
    this.occupied[next] = 1;
    this.moves++;
    if (hybridEarly) this.earlyMoves++;
    if (followingPlan) {
      if (!hybridEarly && !this.usesPartial) this.certifiedMoves++;
      this.activePlan.cursor++;
      const routeLabel = this.usesPartial ? 'Partial-loop route' : hybridEarly ? this.activePlan.kind === 'handoff' ? 'Handoff route' : 'Greedy route' : 'Certified route';
      const revised = this.greedyReplans + this.certifiedReplans + this.partialReplans > replansBefore ? ' revised' : '';
      this.lastAction = `${routeLabel}${revised} · ${this.activePlan.path.length - this.activePlan.cursor} moves left`;
      if (this.activePlan.cursor === this.activePlan.path.length) {
        if (!grows) throw new Error('Certified route did not end at food.');
        if (this.usesPartial || (this.algorithm === 'greedy_partial' && this.activePlan.kind === 'handoff')) {
          this.partialLoop = this.activePlan.loop;
          this.partialParents = this.activePlan.parents ?? [];
          if (this.partialLoop) {
            this.cycle = this.partialParents[0]?.parent ?? this.partialLoop;
            this.positions = cyclePositions(this.cycle);
          }
        }
        if (this.activePlan.cycle) {
          this.cycle = this.activePlan.cycle;
          this.positions = cyclePositions(this.cycle);
          this.repairs++;
        }
        if (hybridEarly && this.activePlan.kind === 'handoff') {
          this.hybridPhase = this.algorithm === 'greedy_partial' ? 'partial' : 'certified';
          this.hybridSwitchMove = this.moves;
          this.hybridSwitchActualLength = this.body.length;
        }
        this.activePlan = null;
        this.lastAction = this.usesPartial ? 'Food reached · local loop restored' : hybridEarly && this.hybridPhase !== 'certified' ? 'Food reached · local safety checked' : 'Food reached · safe cycle restored';
      }
    }
    if (grows) {
      this.foods++;
      this.history.push([this.moves, this.body.length]);
      if (this.body.length === this.size) {
        this.status = 'won';
        this.food = null;
        this.lastAction = 'Every cell filled';
      } else this.spawnFood();
    }
    return true;
  }

  assertInvariants() {
    if (new Set(this.cycle).size !== this.size || this.cycle.some(c => !Number.isInteger(c) || c < 0 || c >= this.size)) throw new Error('Cycle does not cover the board.');
    for (let i = 0; i < this.size; i++) {
      if (this.positions[this.cycle[i]] !== i) throw new Error('Invalid cycle index.');
      if (!adjacent(this.cycle[i], this.cycle[(i + 1) % this.size], this.width)) throw new Error('Broken cycle edge.');
    }
    if (new Set(this.body).size !== this.body.length) throw new Error('Self collision.');
    const hybridEarly = this.greedyEarly;
    const certifiedWin = (this.algorithm === 'certified' || this.algorithm === 'hybrid' || this.algorithm === 'lanekeeper') && this.status === 'won';
    if (this.usesPartial) {
      if (this.activePlan ? !validatePartialPlan(this, this.activePlan) : this.status !== 'won' && !validatePartialState(this)) throw new Error('Invalid partial loop or expansion certificate.');
    } else if (this.activePlan) {
      if (!(hybridEarly ? validateHybridPlan(this, this.activePlan) : validatePlan(this, this.activePlan))) throw new Error('Invalid remaining route or terminal certificate.');
    } else if (hybridEarly && this.status === 'running') {
      if (!inspectSpace(this, this.body).safe) throw new Error('Hybrid lost its checked tail access.');
    } else if (!certifiedWin && !hybridEarly) {
      if (!bodyOrdered(this.body, this.positions, this.size)) throw new Error('Body order violated.');
      if ((this.algorithm === 'compact' || this.algorithm === 'certified' || this.algorithm === 'hybrid' || this.algorithm === 'lanekeeper') && this.distance(this.body[0], this.body.at(-1)) !== this.size - this.body.length + 1) throw new Error('Compact body invariant violated.');
    }
    for (let i = 1; i < this.body.length; i++) if (!adjacent(this.body[i - 1], this.body[i], this.width)) throw new Error('Disconnected body.');
    const occupied = new Set(this.body);
    for (let i = 0; i < this.size; i++) if (Boolean(this.occupied[i]) !== occupied.has(i)) throw new Error('Occupancy mismatch.');
    if (this.status === 'running' && (this.food === null || this.occupied[this.food])) throw new Error('Invalid food placement.');
    if (this.status === 'won' && (this.body.length !== this.size || this.food !== null)) throw new Error('Invalid win.');
    if (this.status === 'failed' && !(['hybrid', 'greedy_partial'].includes(this.algorithm) && this.lastAction === 'Heuristic found no safe move')) throw new Error('Game failed.');
    return true;
  }
}

export function finishGame(game, verify = false) {
  const limit = game.moveLimit;
  while (game.status === 'running' && game.moves <= limit) {
    const food = game.food;
    const before = game.progressMeasure();
    const heuristicStep = game.usesPartial || game.greedyEarly;
    game.step();
    if (verify) {
      game.assertInvariants();
      if (!heuristicStep && game.food === food && game.status === 'running' && game.progressMeasure() >= before) throw new Error('Food progress violated.');
    }
  }
  if (game.status === 'running') game.status = 'timeout';
  return game;
}

export function summarize(rows) {
  return ALGORITHMS.map(algorithm => {
    const games = rows.filter(row => row.algorithm === algorithm);
    const wins = games.filter(row => row.status === 'won');
    const moves = wins.map(row => row.moves).sort((a, b) => a - b);
    const mean = (key, list = wins) => list.length ? list.reduce((sum, row) => sum + row[key], 0) / list.length : null;
    const median = moves.length ? (moves[Math.floor((moves.length - 1) / 2)] + moves[Math.floor(moves.length / 2)]) / 2 : null;
    return { algorithm, games: games.length, wins: wins.length, meanMoves: mean('moves'), medianMoves: median, p95Moves: moves.length ? moves[Math.ceil(moves.length * .95) - 1] : null, meanMs: mean('elapsedMs', games), meanRepairs: mean('repairs'), meanShortcuts: mean('shortcuts') };
  });
}
