// Partial loops with reversible split certificates. Every omitted cell belongs
// to a detached cycle; reversing the split stack restores the complete board.
import { simulateRoute } from './certified.js';
import { movingFoodRoutes, foodExitCost } from './routing.js';

// Bipartite degree-two completion is a flow problem, not Hamiltonian search.
// Force body edges, then cover the remaining grid by disjoint simple cycles.
// A cover is accepted only if explicit square merges connect every component.
export function partialCertificate(game, body, variant = 0) {
  const n = game.size, source = n, sink = n + 1;
  const graph = Array.from({ length: n }, () => []), network = Array.from({ length: n + 2 }, () => []);
  const add = (a, b, cap) => {
    const edge = { to: b, cap, reverse: network[b].length };
    network[a].push(edge); network[b].push({ to: a, cap: 0, reverse: network[a].length - 1 });
    return edge;
  };
  for (let i = 1; i < body.length; i++) { graph[body[i]].push(body[i - 1]); graph[body[i - 1]].push(body[i]); }
  const optional = []; let required = 0;
  for (let cell = 0; cell < n; cell++) {
    const demand = 2 - graph[cell].length;
    if ((cell % game.width + Math.floor(cell / game.width)) % 2 === 0) {
      add(source, cell, demand); required += demand;
      const neighbors = game.neighbors(cell);
      if (variant & 1) neighbors.reverse();
      // Favor the current full-board scaffold in one variant; the other
      // naturally discovers smaller cycles. Neither constrains the live body.
      if (!(variant & 1)) neighbors.sort((a, b) => Number(game.distance(cell, b) === 1 || game.distance(b, cell) === 1) - Number(game.distance(cell, a) === 1 || game.distance(a, cell) === 1));
      for (const next of neighbors) if (!graph[cell].includes(next)) optional.push({ a: cell, b: next, edge: add(cell, next, 1) });
    } else add(cell, sink, demand);
  }
  let flow = 0;
  while (flow < required) {
    const previous = new Int32Array(n + 2).fill(-1), edgeIndex = new Int32Array(n + 2), queue = [source]; previous[source] = source;
    for (let read = 0; read < queue.length && previous[sink] < 0; read++) {
      const cell = queue[read];
      for (let i = 0; i < network[cell].length; i++) {
        const edge = network[cell][i];
        if (edge.cap && previous[edge.to] < 0) { previous[edge.to] = cell; edgeIndex[edge.to] = i; queue.push(edge.to); }
      }
    }
    if (previous[sink] < 0) return null;
    for (let cell = sink; cell !== source; cell = previous[cell]) {
      const edge = network[previous[cell]][edgeIndex[cell]];
      edge.cap--; network[cell][edge.reverse].cap++;
    }
    flow++;
  }
  for (const { a, b, edge } of optional) if (!edge.cap) { graph[a].push(b); graph[b].push(a); }
  if (graph.some(edges => edges.length !== 2)) return null;
  const local = walk(graph, body[0], graph[body[0]].find(cell => cell !== body[1]));
  if (!validPartialLoop(game, local, body)) return null;
  const merges = []; let current = local;
  while (current.length < n) {
    const members = new Set(current); let merged = false;
    const connections = [];
    for (const [a, b, c, d] of game.squares) {
      let edges;
      if (graph[a].includes(b) && graph[c].includes(d) && members.has(a) !== members.has(c)) edges = [a, b, c, d];
      else if (graph[a].includes(d) && graph[b].includes(c) && members.has(a) !== members.has(b)) edges = [a, d, c, b];
      if (!edges) continue;
      const [u, v, w, x] = edges;
      const p = body.indexOf(members.has(u) ? u : w), q = body.indexOf(members.has(u) ? v : x);
      const delay = p >= 0 && q >= 0 && Math.abs(p - q) === 1 ? body.length - 1 - Math.min(p, q) : 0;
      connections.push({ edges, delay });
    }
    connections.sort((a, b) => a.delay - b.delay);
    for (const { edges } of connections) {
      const [u, v, w, x] = edges;
      const detached = walk(graph, members.has(u) ? w : u);
      flip(graph, u, v, w, x);
      // Preserve the orientation of a retained child edge, even if the removed
      // edge currently runs through the body. Rotation will release it later.
      const start = current.findIndex((cell, i) => graph[cell].includes(current[(i + 1) % current.length]));
      const parent = walk(graph, current[start], current[(start + 1) % current.length]);
      merges.push({ parent, child: current, detached, bridge: [u, x, w, v] });
      current = parent; merged = true; break;
    }
    if (!merged) return null;
  }
  return { loop: local, parents: merges.reverse() };
}

export function validatePartialPlan(game, plan) {
  if (!plan || plan.kind !== 'partial' || plan.food !== game.food || !Number.isInteger(plan.cursor) || plan.cursor < 0 || plan.cursor >= plan.path.length) return false;
  const body = simulateRoute(game, plan.path.slice(plan.cursor));
  if (!body) return false;
  if (body.length === game.size) return true;
  const terminal = Object.create(game);
  Object.assign(terminal, { body, partialLoop: plan.loop, partialParents: plan.parents });
  return validatePartialState(terminal);
}

// Expected next-food distance under the certified expand-and-follow fallback.
// This integrates over possible empty cells and never reads the next RNG draw.
function expansionCost(game, body, certificate) {
  const originalBody = new Set(body), seen = new Set(originalBody);
  let current = certificate.loop, head = body[0], elapsed = 0, total = 0;
  for (let level = certificate.parents.length; level >= 0; level--) {
    const headIndex = current.indexOf(head);
    for (let i = 1; i < current.length; i++) {
      const cell = current[(headIndex + i) % current.length];
      if (!seen.has(cell)) { seen.add(cell); total += elapsed + i; }
    }
    if (!level) break;
    const parent = certificate.parents[level - 1].parent;
    const positions = new Int32Array(game.size).fill(-1); parent.forEach((cell, i) => { positions[cell] = i; });
    const bridge = current.findIndex((cell, i) => positions[current[(i + 1) % current.length]] !== (positions[cell] + 1) % parent.length);
    const behind = (headIndex - bridge + current.length) % current.length;
    const wait = behind > 0 && behind < body.length ? body.length - behind : 0;
    head = current[(headIndex + wait) % current.length]; elapsed += wait; current = parent;
  }
  return total / (game.size - body.length);
}

function findPartialRoute(game) {
  const previous = game.activePlan;
  const head = game.partialLoop.indexOf(game.body[0]), food = game.partialLoop.indexOf(game.food);
  const limit = previous ? previous.path.length - previous.cursor : food < 0 ? game.size : (food - head + game.partialLoop.length) % game.partialLoop.length;
  const routes = movingFoodRoutes(game, { maxLength: limit - 1, maxNodes: 160, variants: 4 });
  const ranked = routes.map(path => ({ path, body: simulateRoute(game, path) })).filter(r => r.body);
  ranked.sort((a, b) => a.path.length - b.path.length);
  let best = null, bestCost = Infinity;
  let fallbackCost = Infinity;
  if (!previous && food >= 0 && game.body.length + 1 < game.size) {
    const grown = Array.from({ length: game.body.length + 1 }, (_, i) => game.partialLoop[(food - i + game.partialLoop.length) % game.partialLoop.length]);
    fallbackCost = limit + expansionCost(game, grown, { loop: game.partialLoop, parents: game.partialParents });
  }
  for (const { path, body } of ranked) {
    if (best && path.length > best.path.length) break;
    if (body.length === game.size) return { kind: 'partial', path, cursor: 0, food: game.food, loop: null, parents: [] };
    for (let variant = 0; variant < 2; variant++) {
      const certificate = partialCertificate(game, body, variant);
      if (!certificate) continue;
      const expectedNext = expansionCost(game, body, certificate);
      if (path.length + expectedNext > fallbackCost) continue;
      const cost = expectedNext + foodExitCost(game, body) / game.size * .1;
      if (cost < bestCost) {
        best = { kind: 'partial', path, cursor: 0, food: game.food, ...certificate };
        bestCost = cost;
      }
    }
  }
  return best;
}

export function validPartialLoop(game, loop, body = game.body) {
  if (!loop || loop.length < 4 || loop.length < body.length || new Set(loop).size !== loop.length) return false;
  if (loop.some((cell, i) => !Number.isInteger(cell) || cell < 0 || cell >= game.size || !game.neighbors(cell).includes(loop[(i + 1) % loop.length]))) return false;
  if (!body.length) return true;
  const head = loop.indexOf(body[0]);
  return head >= 0 && body.every((cell, i) => loop[(head - i + loop.length) % loop.length] === cell);
}

function graphOf(game, loop) {
  const graph = Array.from({ length: game.size }, () => []);
  loop.forEach((cell, i) => { graph[cell] = [loop[(i + loop.length - 1) % loop.length], loop[(i + 1) % loop.length]]; });
  return graph;
}
function walk(graph, start, next = graph[start][0]) {
  const path = [start]; let previous = start, current = next;
  while (current !== start && path.length <= graph.length) {
    path.push(current);
    const following = graph[current][0] === previous ? graph[current][1] : graph[current][0];
    previous = current; current = following;
  }
  return path;
}
function flip(graph, a, b, c, d) {
  graph[a][graph[a].indexOf(b)] = d; graph[b][graph[b].indexOf(a)] = c;
  graph[c][graph[c].indexOf(d)] = b; graph[d][graph[d].indexOf(c)] = a;
}

export function validatePartialState(game) {
  let child = game.partialLoop;
  if (!Array.isArray(game.partialParents) || !validPartialLoop(game, child)) return false;
  for (let i = game.partialParents.length - 1; i >= 0; i--) {
    const record = game.partialParents[i], { parent, detached, bridge } = record;
    if (record.child !== child || !validPartialLoop(game, detached, []) || !validPartialLoop(game, parent, [])) return false;
    const cells = new Set([...child, ...detached]);
    if (cells.size !== child.length + detached.length || cells.size !== parent.length || parent.some(cell => !cells.has(cell))) return false;
    const [a, b, c, d] = bridge, graph = graphOf(game, parent);
    if (!graph[a].includes(b) || !graph[c].includes(d)) return false;
    const positions = new Int32Array(game.size).fill(-1);
    parent.forEach((cell, index) => { positions[cell] = index; });
    // The parent must retain the child's direction, not just its undirected
    // edges; a reversed parent could never fit the circulating body.
    for (let j = 0; j < child.length; j++) {
      const cell = child[j], next = child[(j + 1) % child.length];
      if (graph[cell].includes(next) && parent[(positions[cell] + 1) % parent.length] !== next) return false;
    }
    flip(graph, a, b, c, d);
    for (const loop of [child, detached]) if (loop.some((cell, j) => !graph[cell].includes(loop[(j + 1) % loop.length]))) return false;
    child = parent;
  }
  return child.length === game.size;
}

export function expandPartialLoop(game) {
  let loop = game.partialLoop;
  // Merge before moving whenever the bridge no longer lies inside the body.
  // Until then circulate on the child loop: food is outside, so length is fixed.
  while (!loop.includes(game.food)) {
    const record = game.partialParents.at(-1);
    if (!record) throw new Error('Missing partial-loop expansion certificate.');
    if (!validPartialLoop(game, record.parent)) return false;
    game.partialParents = game.partialParents.slice(0, -1);
    game.partialLoop = loop = record.parent;
    game.partialMerges++;
  }
  return true;
}

export function choosePartialMove(game) {
  const replacement = findPartialRoute(game);
  if (replacement) {
    if (game.activePlan) game.partialReplans++;
    game.activePlan = replacement; game.partialRoutes++;
  }
  if (game.activePlan) return game.activePlan.path[game.activePlan.cursor];
  if (!expandPartialLoop(game)) {
    game.partialRecoveryMoves++;
    game.lastAction = 'Clearing the tail for loop expansion';
    const loop = game.partialLoop;
    return loop[(loop.indexOf(game.body[0]) + 1) % loop.length];
  }
  let loop = game.partialLoop;
  // Split only unlocked edges, keep the body and current food on the same
  // child, and require a strictly shorter route. Parent records are immutable.
  for (let pass = 0; pass < 4; pass++) {
    const head = game.body[0], headIndex = loop.indexOf(head);
    const distance = (loop.indexOf(game.food) - headIndex + loop.length) % loop.length;
    const lower = Math.abs(head % game.width - game.food % game.width) + Math.abs(Math.floor(head / game.width) - Math.floor(game.food / game.width));
    if (distance === lower) break;
    const graph = graphOf(game, loop), rank = new Int32Array(game.size).fill(-1);
    game.body.forEach((cell, i) => { rank[cell] = i; });
    let best = null, bestScore = 0;
    for (const square of game.squares) {
      const [a, b, c, d] = square;
      let edges;
      if (graph[a].includes(b) && graph[c].includes(d) && !graph[a].includes(d) && !graph[b].includes(c)) edges = [a, b, c, d];
      else if (graph[a].includes(d) && graph[b].includes(c) && !graph[a].includes(b) && !graph[c].includes(d)) edges = [a, d, c, b];
      if (!edges) continue;
      const [u, v, w, x] = edges;
      if ((rank[u] >= 0 && rank[v] >= 0 && Math.abs(rank[u] - rank[v]) === 1) || (rank[w] >= 0 && rank[x] >= 0 && Math.abs(rank[w] - rank[x]) === 1)) continue;
      flip(graph, u, v, w, x);
      const child = walk(graph, head, graph[head].find(cell => cell !== game.body[1]));
      const foodDistance = child.indexOf(game.food);
      if (child.length < loop.length && foodDistance > 0 && foodDistance < distance && validPartialLoop(game, child)) {
        const members = new Set(child), detached = walk(graph, loop.find(cell => !members.has(cell)));
        // Estimate the next meal without looking at the food RNG. If it lands
        // outside, include the wait until the just-created bridge leaves the body.
        const grownLength = game.body.length + 1;
        const parentPositions = new Int32Array(game.size).fill(-1);
        loop.forEach((cell, i) => { parentPositions[cell] = i; });
        const bridgeIndex = child.findIndex((cell, i) => parentPositions[child[(i + 1) % child.length]] !== (parentPositions[cell] + 1) % loop.length);
        const behind = (foodDistance - bridgeIndex + child.length) % child.length;
        const wait = behind > 0 && behind < grownLength ? grownLength - behind : 0;
        const futureHead = child[(foodDistance + wait) % child.length], parentHead = parentPositions[futureHead];
        const insideFree = child.length - grownLength;
        let nextCost = insideFree * (insideFree + 1) / 2;
        for (const cell of detached) nextCost += wait + (parentPositions[cell] - parentHead + loop.length) % loop.length;
        const baselineNext = (loop.length - grownLength + 1) / 2;
        const extraNext = nextCost / (loop.length - grownLength) - baselineNext;
        const score = distance - foodDistance - game.partialCutPenalty * Math.max(0, extraNext);
        if (score > bestScore) {
          best = { parent: loop, child, detached, bridge: edges };
          bestScore = score;
        }
      }
      flip(graph, u, x, w, v);
    }
    if (!best) break;
    game.partialParents = [...game.partialParents, best];
    game.partialLoop = loop = best.child;
    game.partialSplits++;
  }
  game.lastAction = game.partialParents.length ? 'Following a partial loop' : 'Following the restored full loop';
  return loop[(loop.indexOf(game.body[0]) + 1) % loop.length];
}
