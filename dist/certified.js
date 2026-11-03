// Route search is deliberately separate from the live simulation. A proposed
// shortcut must have an executable path AND a completion certificate at food.
import { movingFoodRoutes } from './routing.js';
function neighborsFor(game) {
  return game.routeNeighbors ??= Array.from({ length: game.size }, (_, cell) => game.neighbors(cell));
}

export function simulateRoute(game, route) {
  if (!route.length || route.at(-1) !== game.food) return null;
  const body = [...game.body], neighbors = neighborsFor(game);
  for (let i = 0; i < route.length; i++) {
    const next = route[i], grows = next === game.food;
    if (!Number.isInteger(next) || next < 0 || next >= game.size) return null;
    if (grows && i !== route.length - 1) return null;
    if (!neighbors[body[0]].includes(next)) return null;
    if (body.includes(next) && !(next === body.at(-1) && !grows)) return null;
    if (!grows) body.pop();
    body.unshift(next);
  }
  return body;
}

export function cycleContainsBody(game, cycle, body) {
  if (!Array.isArray(cycle) || cycle.length !== game.size || new Set(cycle).size !== game.size) return false;
  const neighbors = neighborsFor(game), positions = new Int32Array(game.size);
  for (let i = 0; i < cycle.length; i++) {
    const cell = cycle[i];
    if (!Number.isInteger(cell) || cell < 0 || cell >= game.size || !neighbors[cell].includes(cycle[(i + 1) % game.size])) return false;
    positions[cell] = i;
  }
  return body.every((cell, i) => i === 0 || (positions[cell] + 1) % game.size === positions[body[i - 1]]);
}

export function validatePlan(game, plan) {
  if (!plan || plan.food !== game.food || !Number.isInteger(plan.cursor) || plan.cursor < 0 || plan.cursor >= plan.path.length) return false;
  const terminalBody = simulateRoute(game, plan.path.slice(plan.cursor));
  return Boolean(terminalBody && (terminalBody.length === game.size || cycleContainsBody(game, plan.cycle, terminalBody)));
}

// Find a Hamiltonian path through all free cells from the proposed final head
// to its final tail. The body supplies the rest of the closed cycle. Degree
// constraints and connectivity prune impossible branches. Budget exhaustion
// means "not certified", never "safe enough". No food RNG is read or advanced.
export function completeHamiltonianCycle(game, body, maxNodes = 2000) {
  const { size } = game, neighbors = neighborsFor(game), head = body[0], tail = body.at(-1);
  const open = new Uint8Array(size).fill(1);
  for (const cell of body) open[cell] = 0;
  open[tail] = 1;
  let remaining = size - body.length + 1;
  const degree = new Int8Array(size);
  for (let cell = 0; cell < size; cell++) if (open[cell]) degree[cell] = neighbors[cell].reduce((sum, next) => sum + open[next], 0);
  const path = [], seen = new Uint32Array(size), queue = new Int32Array(size);
  let nodes = 0, stamp = 0;
  const connected = start => {
    stamp++;
    let read = 0, write = 1;
    queue[0] = start; seen[start] = stamp;
    while (read < write) for (const next of neighbors[queue[read++]]) {
      if (open[next] && seen[next] !== stamp) { seen[next] = stamp; queue[write++] = next; }
    }
    return write === remaining;
  };
  const forward = (from, to) => (game.positions[to] - game.positions[from] + size) % size;
  function search(current) {
    if (++nodes > maxNodes) return false;
    if (remaining === 1) {
      if (neighbors[current].includes(tail)) { path.push(tail); return true; }
      return false;
    }
    let forced = -1;
    for (let cell = 0; cell < size; cell++) {
      if (!open[cell]) continue;
      if (degree[cell] === 0) return false;
      if (cell !== tail && degree[cell] === 1) {
        if (forced !== -1 || !neighbors[current].includes(cell)) return false;
        forced = cell;
      }
    }
    const options = neighbors[current].filter(cell => open[cell] && cell !== tail && (forced === -1 || cell === forced));
    if (!options.length || !connected(tail)) return false;
    options.sort((a, b) => degree[a] - degree[b] || forward(current, a) - forward(current, b));
    for (const next of options) {
      open[next] = 0; remaining--; path.push(next);
      for (const n of neighbors[next]) if (open[n]) degree[n]--;
      if (search(next)) return true;
      for (const n of neighbors[next]) if (open[n]) degree[n]++;
      open[next] = 1; remaining++; path.pop();
      if (nodes > maxNodes) break;
    }
    return false;
  }
  if (!search(head)) return null;
  const cycle = [head, ...path, ...body.slice(1, -1).reverse()];
  return cycleContainsBody(game, cycle, body) ? cycle : null;
}

export function findCertifiedRoute(game, maxNodes = 2000, maxLength = game.distance(game.body[0], game.food) - 1) {
  if (game.food === null) return null;
  const manhattan = Math.abs(game.body[0] % game.width - game.food % game.width) + Math.abs(Math.floor(game.body[0] / game.width) - Math.floor(game.food / game.width));
  if (maxLength < manhattan) return null;
  const { size, body, food } = game, neighbors = neighborsFor(game);
  const head = body[0], tail = body.at(-1);
  const paths = [], seenPaths = new Set();
  const addPath = parent => {
    if (parent[food] === -1) return;
    const path = [];
    for (let cell = food; cell !== head; cell = parent[cell]) path.push(cell);
    path.reverse();
    if (path.length > maxLength) return;
    const key = path.join(',');
    if (!seenPaths.has(key)) { seenPaths.add(key); paths.push(path); }
  };
  const searchPath = (order, bannedFrom = -1, bannedTo = -1) => {
    const parent = new Int32Array(size).fill(-1), queue = [head]; parent[head] = head;
    for (let read = 0; read < queue.length && parent[food] === -1; read++) {
      const current = queue[read], candidates = neighbors[current].slice();
      if (order & 4) candidates.reverse();
      for (let i = 0; i < candidates.length; i++) {
        const next = candidates[(i + order % 4) % candidates.length];
        if ((game.occupied[next] && next !== tail) || parent[next] !== -1) continue;
        if ((current === bannedFrom && next === bannedTo) || (current === bannedTo && next === bannedFrom)) continue;
        parent[next] = current; queue.push(next);
      }
    }
    addPath(parent);
  };
  for (let order = 0; order < 8; order++) searchPath(order);
  const base = paths[0];
  if (base) for (let i = 0; i < base.length && paths.length < 24; i++) searchPath(0, i === 0 ? head : base[i - 1], base[i]);
  for (const path of movingFoodRoutes(game, { maxLength, maxNodes: 400, variants: 8 })) {
    const key = path.join(',');
    if (!seenPaths.has(key)) { seenPaths.add(key); paths.push(path); }
  }
  paths.sort((a, b) => a.length - b.length);
  for (const path of paths) {
    const terminalBody = simulateRoute(game, path);
    if (!terminalBody) continue;
    const cycle = terminalBody.length === size ? null : completeHamiltonianCycle(game, terminalBody, maxNodes);
    const plan = { path, cycle, cursor: 0, food };
    if (validatePlan(game, plan)) return plan;
  }
  return null;
}
