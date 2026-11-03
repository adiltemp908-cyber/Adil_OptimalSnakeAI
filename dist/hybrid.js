import { simulateRoute, completeHamiltonianCycle, cycleContainsBody } from './certified.js';
import { movingFoodRoutes, foodExitCost } from './routing.js';
import { partialCertificate, validatePartialPlan } from './partial.js';

// Repeated recovery states have identical bounded-search results. Cache the
// pure searches, not move choices: visit penalties and replanning still run.
function cachedSearch(game, kind, key, compute) {
  if (game.disableHybridCache) return compute();
  if (game.hybridCacheCycle !== game.cycle) {
    game.hybridCacheCycle = game.cycle;
    game.hybridSearchCaches = { routes: new Map(), cycles: new Map() };
  }
  const cache = game.hybridSearchCaches[kind];
  if (cache.has(key)) return cache.get(key);
  const result = compute();
  cache.set(key, result);
  if (cache.size > 512) cache.delete(cache.keys().next().value);
  return result;
}

const hybridPartial = (game, body) => cachedSearch(game, 'cycles', body.join(','), () => partialCertificate(game, body, 0) ?? partialCertificate(game, body, 1));

const hybridCycle = (game, body) => cachedSearch(game, 'cycles', body.join(','), () => completeHamiltonianCycle(game, body, 10000));

// These are local anti-trap checks, not a proof that every future food is winnable.
// With the head removed and the departing tail open, check tail access and
// whether the empty region is connected. Neither implies eventual completion.
export function inspectSpace(game, body) {
  const blocked = new Uint8Array(game.size);
  for (const cell of body) blocked[cell] = 1;
  const head = body[0], tail = body.at(-1);
  blocked[tail] = 0;
  const seen = new Uint8Array(game.size), queue = [tail]; seen[tail] = 1;
  for (let read = 0; read < queue.length; read++) for (const next of game.neighbors(queue[read])) {
    if (!blocked[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
  }
  const exits = game.neighbors(head).filter(cell => seen[cell]);
  return { safe: exits.length > 0, connected: queue.length === game.size - body.length + 1, reachable: queue.length, exits: exits.length };
}

// Stretch a head-to-tail path with two-cell detours. Together with the body
// this makes a roomy local escape loop; it need not cover the board.
function stretchTailPath(game) {
  const shortest = shortestPath(game, game.body.at(-1));
  if (!shortest) return null;
  const path = [game.body[0], ...shortest], used = new Set([...game.body, ...path]);
  for (let i = 0; i + 1 < path.length;) {
    const a = path[i], b = path[i + 1];
    let inserted = false;
    for (const c of game.neighbors(a)) {
      if (used.has(c)) continue;
      const d = c + b - a;
      if (d < 0 || d >= game.size || used.has(d) || !game.neighbors(b).includes(d) || !game.neighbors(c).includes(d)) continue;
      path.splice(i + 1, 0, c, d); used.add(c); used.add(d); inserted = true; break;
    }
    if (!inserted) i++;
  }
  return path.slice(1);
}

function shortestPath(game, target, order = 0, bannedFrom = -1, bannedTo = -1) {
  const head = game.body[0], tail = game.body.at(-1);
  const parent = new Int32Array(game.size).fill(-1), queue = [head]; parent[head] = head;
  for (let read = 0; read < queue.length && parent[target] === -1; read++) {
    const current = queue[read], neighbors = game.neighbors(current);
    if (order & 4) neighbors.reverse();
    for (let i = 0; i < neighbors.length; i++) {
      const next = neighbors[(i + order % 4) % neighbors.length];
      if ((game.occupied[next] && next !== tail) || parent[next] !== -1) continue;
      if ((current === bannedFrom && next === bannedTo) || (current === bannedTo && next === bannedFrom)) continue;
      parent[next] = current; queue.push(next);
    }
  }
  if (parent[target] === -1) return null;
  const path = [];
  for (let cell = target; cell !== head; cell = parent[cell]) path.push(cell);
  return path.reverse();
}

export function validateHybridPlan(game, plan) {
  if (!plan || plan.food !== game.food || !Number.isInteger(plan.cursor) || plan.cursor < 0 || plan.cursor >= plan.path.length) return false;
  const body = simulateRoute(game, plan.path.slice(plan.cursor));
  if (!body) return false;
  if (body.length === game.size) return true;
  if (plan.kind === 'handoff' && game.algorithm === 'greedy_partial') return validatePartialPlan(game, { ...plan, kind: 'partial' });
  if (plan.kind === 'handoff') return cycleContainsBody(game, plan.cycle, body);
  return plan.kind === 'early' && inspectSpace(game, body).safe;
}

export function chooseHybridMove(game) {
  const partial = game.algorithm === 'greedy_partial';
  const previous = game.activePlan;
  const remaining = previous?.path.slice(previous.cursor);
  // The handoff carries a full completion certificate. Keep it until a strictly
  // shorter replacement has its own certificate; early plans can also improve
  // the post-food shape without increasing their remaining move count.
  const maxLength = remaining ? remaining.length - (previous.kind === 'handoff' ? 1 : 0) : game.size - 1;
  const handingOff = game.body.length + 1 >= game.hybridSwitchLength;
  game.hybridPhase = handingOff ? 'handoff' : 'greedy';
  const candidates = [], seen = new Set();
  const add = path => {
    if (!path?.length || path.length > maxLength) return;
    const key = path.join(',');
    if (!seen.has(key)) { seen.add(key); candidates.push(path); }
  };
  const movingRoutes = cachedSearch(game, 'routes', `${game.food}/${maxLength}/${game.body.join(',')}`, () => movingFoodRoutes(game, { maxLength, acceptBody: body => body.length === game.size || inspectSpace(game, body).safe }));
  for (const path of movingRoutes) add(path);
  for (let order = 0; order < 8; order++) add(shortestPath(game, game.food, order));
  const base = candidates[0];
  if (base) for (let i = 0; i < base.length && candidates.length < 24; i++) add(shortestPath(game, game.food, 0, i ? base[i - 1] : game.body[0], base[i]));
  const tailPath = previous ? null : stretchTailPath(game);
  const foodIndex = tailPath?.indexOf(game.food) ?? -1;
  if (foodIndex >= 0) add(tailPath.slice(0, foodIndex + 1));
  const ranked = candidates.map(path => {
    const body = simulateRoute(game, path);
    return { path, body, cost: body ? foodExitCost(game, body) : Infinity };
  }).filter(candidate => candidate.body && (candidate.body.length === game.size || inspectSpace(game, candidate.body).safe));
  ranked.sort((a, b) => a.path.length - b.path.length || a.cost - b.cost);
  const previousBody = remaining ? simulateRoute(game, remaining) : null;
  const previousCost = previousBody ? foodExitCost(game, previousBody) : Infinity;
  let earlyAlternative = null;
  for (const { path, body, cost } of ranked) {
    if (previous && path.length === remaining.length && cost >= previousCost) continue;
    if (!earlyAlternative) earlyAlternative = { kind: 'early', path, cursor: 0, food: game.food, cycle: null };
    // No Hamiltonian search before the threshold-crossing meal. At handoff,
    // prefer a route whose resulting body has a complete cycle certificate.
    const certificate = handingOff && partial && body.length < game.size ? hybridPartial(game, body) : null;
    const cycle = handingOff && !partial && body.length < game.size ? hybridCycle(game, body) : null;
    const plan = { kind: handingOff ? 'handoff' : 'early', path, cursor: 0, food: game.food, cycle, ...(certificate ?? {}) };
    if (partial && handingOff && body.length < game.size && !certificate) continue;
    if (!validateHybridPlan(game, plan)) continue;
    game.activePlan = plan;
    if (previous) game.greedyReplans = (game.greedyReplans ?? 0) + 1;
    else game.earlyRoutes++;
    return path[0];
  }
  if (previous) return remaining[0];
  if (handingOff) {
    const certificate = partial ? hybridPartial(game, game.body) : null;
    const cycle = partial ? certificate?.parents[0]?.parent ?? certificate?.loop : hybridCycle(game, game.body);
    if (cycle) {
      if (partial) { game.partialLoop = certificate.loop; game.partialParents = certificate.parents; }
      game.cycle = cycle;
      game.positions = new Int32Array(game.size);
      cycle.forEach((cell, index) => { game.positions[cell] = index; });
      game.hybridPhase = partial ? 'partial' : 'certified';
      game.hybridSwitchMove = game.moves;
      game.hybridSwitchActualLength = game.body.length;
      game.repairs++;
      return game.chooseMove();
    }
  }
  // If the food route fails the checks, move toward the tail to free space and
  // retry. A deterministic visit penalty discourages repeating the same state.
  const recent = game.hybridVisits ??= new Map();
  const choices = [];
  for (const next of game.neighbors(game.body[0])) {
    if (next === game.food || (game.occupied[next] && next !== game.body.at(-1))) continue;
    const body = [next, ...game.body.slice(0, -1)], space = inspectSpace(game, body);
    if (!space.safe) continue;
    const key = body.join(','), visits = recent.get(key) ?? 0;
    choices.push({ next, key, score: (next === tailPath?.[0] ? 10 : 0) + space.exits - visits * 20 });
  }
  choices.sort((a, b) => b.score - a.score);
  if (!choices.length) {
    // A newly spawned food can block the only escape. Permit checked growth
    // rather than declaring failure just because handoff is not yet possible.
    if (earlyAlternative) {
      game.activePlan = earlyAlternative;
      game.earlyRoutes++;
      return earlyAlternative.path[0];
    }
    return null;
  }
  const choice = choices[0];
  recent.set(choice.key, (recent.get(choice.key) ?? 0) + 1);
  if (recent.size > game.size * 4) recent.delete(recent.keys().next().value);
  game.hybridRecoveryMoves++;
  return choice.next;
}
