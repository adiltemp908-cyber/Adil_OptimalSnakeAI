// Lanekeeper: cell-tree routing with a certificate checked before every move.
//
// Safety rule: before each move we build a Hamiltonian cycle on which the
// moved body is one unbroken stretch (head first, free cells ahead, tail last)
// and verify it cell by cell. Following that cycle is safe forever and passes
// every cell, so a certified state can always continue and always win. If no
// move toward food can be certified, the snake follows the current cycle.
//
// Routing (idea from twanvl/snake's cell-tree agent): split the board into 2x2
// blocks and drive on the right inside each block, so every cell has just two
// legal moves. Blocks entered this way form a tree, and the outline of any
// spanning tree of blocks is a Hamiltonian cycle, which makes certificates
// cheap to build. Boards with an odd side fall back to a general search.
//
// Progress: each apple gets `freeBudget` unrestricted moves; after that a move
// is taken only if it brings the food strictly closer along the new cycle.

const neighborsOf = game => game.laneNeighbors ??= Array.from({ length: game.size }, (_, c) => game.neighbors(c));
export const lanekeeperSettings = { freeBudget: null, generalNodes: 2000, parentCost: 1, sameCost: 1.499, newCost: 3.4, samples: 12, horizon: 1, stratified: 1, searchNodes: 3000 };
const blockMode = game => game.width % 2 === 0 && game.height % 2 === 0;

export function positionsOf(cycle) {
  const positions = new Int32Array(cycle.length);
  cycle.forEach((c, i) => { positions[c] = i; });
  return positions;
}

// `cycle` starts at the head, is a Hamiltonian cycle, and ends with the body
// in reverse: cycle[size - i] === body[i] for every non-head body cell.
export function certifies(game, cycle, body) {
  const { size } = game, nb = neighborsOf(game);
  if (!Array.isArray(cycle) || cycle.length !== size || cycle[0] !== body[0]) return false;
  const seen = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const c = cycle[i];
    if (!Number.isInteger(c) || c < 0 || c >= size || seen[c]) return false;
    seen[c] = 1;
    if (!nb[c].includes(cycle[(i + 1) % size])) return false;
  }
  for (let i = 1; i < body.length; i++) if (cycle[size - i] !== body[i]) return false;
  return true;
}

// --- 2x2 block geometry (even width and height only) -------------------------
// Inside a block the snake turns anticlockwise; "inside" stays in the block,
// "outside" crosses to the neighbouring block (or -1 at the board edge).
// Block directions: 0 left, 1 right, 2 up, 3 down (opposite = d ^ 1).
function blockMoves(game) {
  return game.laneBlocks ??= (() => {
    const { width: w, height: h, size } = game, bw = w >> 1, bh = h >> 1, blocks = bw * bh;
    const inside = new Int32Array(size), outside = new Int32Array(size), block = new Int32Array(size), outDir = new Int8Array(size).fill(-1);
    for (let c = 0; c < size; c++) {
      const x = c % w, y = Math.floor(c / w);
      block[c] = (x >> 1) + (y >> 1) * bw;
      if (y % 2 === 0) { inside[c] = x % 2 === 0 ? c + w : c - 1; outside[c] = x % 2 === 0 ? (x > 0 ? c - 1 : -1) : (y > 0 ? c - w : -1); }
      else { inside[c] = x % 2 === 0 ? c + 1 : c - w; outside[c] = x % 2 === 0 ? (y < h - 1 ? c + w : -1) : (x < w - 1 ? c + 1 : -1); }
      if (outside[c] >= 0) outDir[c] = outside[c] === c - 1 ? 0 : outside[c] === c + 1 ? 1 : outside[c] === c - w ? 2 : 3;
    }
    const near = new Int32Array(blocks * 4).fill(-1);
    for (let b = 0; b < blocks; b++) {
      const bx = b % bw, by = Math.floor(b / bw);
      if (bx > 0) near[b * 4] = b - 1;
      if (bx < bw - 1) near[b * 4 + 1] = b + 1;
      if (by > 0) near[b * 4 + 2] = b - bw;
      if (by < bh - 1) near[b * 4 + 3] = b + bw;
    }
    return { inside, outside, block, outDir, near, blocks };
  })();
}

// Certificate from the block tree: every crossing the body made is a tree
// edge, every crossing it declined is forbidden; unvisited blocks are joined
// by breadth-first search. The outline of the spanning tree is the cycle.
function blockCycle(game, body) {
  const tree = blockTree(game, body);
  if (!tree || tree.unreached.length) return null;
  const { size } = game, { inside, outside, block, outDir } = blockMoves(game), { link } = tree;
  const cycle = [body[0]];
  for (let c = body[0], i = 1; i < size; i++) {
    c = outside[c] >= 0 && link[block[c] * 4 + outDir[c]] === 1 ? outside[c] : inside[c];
    cycle.push(c);
  }
  return certifies(game, cycle, body) ? cycle : null;
}

// Block tree implied by the body, grown into unvisited blocks. Returns null if
// the body is inconsistent with block driving; "unreached" lists blocks that
// can no longer be attached. link[b * 4 + d]: 1 tree edge, -1 forbidden.
function blockTree(game, body) {
  if (game.width % 2 || game.height % 2) return null;
  const { inside, outside, block, outDir, near, blocks } = blockMoves(game);
  const link = new Int8Array(blocks * 4), visited = new Uint8Array(blocks);
  const set = (b, d, v) => { link[b * 4 + d] = v; link[near[b * 4 + d] * 4 + (d ^ 1)] = v; };
  for (const c of body) visited[block[c]] = 1;
  for (let i = body.length - 1; i > 0; i--) {
    const from = body[i], to = body[i - 1];
    if (to === outside[from]) {
      if (link[block[from] * 4 + outDir[from]] === -1) return null;
      set(block[from], outDir[from], 1);
    } else if (to === inside[from]) {
      if (outside[from] < 0) continue;
      if (link[block[from] * 4 + outDir[from]] === 1) return null;
      set(block[from], outDir[from], -1);
    } else return null;
  }
  // Tree edges must form a tree over the visited blocks.
  let edges = 0, visitedCount = 0;
  for (let b = 0; b < blocks; b++) { visitedCount += visited[b]; edges += (link[b * 4 + 1] === 1) + (link[b * 4 + 3] === 1); }
  if (edges !== visitedCount - 1) return null;
  const reached = new Uint8Array(blocks), queue = new Int32Array(blocks);
  let write = 1;
  queue[0] = block[body[0]]; reached[queue[0]] = 1;
  for (let r = 0; r < write; r++) for (let d = 0; d < 4; d++) {
    const n = near[queue[r] * 4 + d];
    if (link[queue[r] * 4 + d] === 1 && !reached[n]) { reached[n] = 1; queue[write++] = n; }
  }
  if (write !== visitedCount) return null;
  // Grow the tree into unvisited blocks.
  for (let r = 0; r < write; r++) for (let d = 0; d < 4; d++) {
    const b = queue[r], n = near[b * 4 + d];
    if (n < 0 || reached[n] || link[b * 4 + d] === -1) continue;
    reached[n] = 1; queue[write++] = n; set(b, d, 1);
  }
  const unreached = [];
  for (let b = 0; b < blocks; b++) if (!reached[b]) unreached.push(b);
  return { link, unreached };
}

// --- General certificate (any board): Hamiltonian path head -> free -> tail --
function generalCycle(game, body, maxNodes) {
  const { size } = game, nb = neighborsOf(game), head = body[0], tail = body.at(-1);
  const open = new Uint8Array(size).fill(1);
  for (const c of body) open[c] = 0;
  open[tail] = 1;
  let remaining = size - body.length + 1, nodes = 0, stamp = 0;
  const degree = new Int8Array(size), seen = new Uint32Array(size), queue = new Int32Array(size), path = [];
  for (let c = 0; c < size; c++) if (open[c]) for (const n of nb[c]) degree[c] += open[n];
  const forward = (a, b) => (game.positions[b] - game.positions[a] + size) % size;
  const connected = () => {
    stamp++;
    let read = 0, write = 1;
    queue[0] = tail; seen[tail] = stamp;
    while (read < write) for (const n of nb[queue[read++]]) if (open[n] && seen[n] !== stamp) { seen[n] = stamp; queue[write++] = n; }
    return write === remaining;
  };
  const search = cur => {
    if (++nodes > maxNodes) return false;
    if (remaining === 1) return nb[cur].includes(tail);
    let forced = -1;
    for (let c = 0; c < size; c++) {
      if (!open[c] || c === tail) continue;
      if (degree[c] === 0) return false;
      if (degree[c] === 1) { if (forced !== -1 || !nb[cur].includes(c)) return false; forced = c; }
    }
    const options = nb[cur].filter(c => open[c] && c !== tail && (forced === -1 || c === forced));
    if (!options.length || !connected()) return false;
    options.sort((a, b) => degree[a] - degree[b] || forward(cur, a) - forward(cur, b));
    for (const next of options) {
      open[next] = 0; remaining--; path.push(next);
      for (const n of nb[next]) if (open[n]) degree[n]--;
      if (search(next)) return true;
      for (const n of nb[next]) if (open[n]) degree[n]++;
      open[next] = 1; remaining++; path.pop();
      if (nodes > maxNodes) return false;
    }
    return false;
  };
  if (!search(head)) return null;
  const cycle = [head, ...path, tail, ...body.slice(1, -1).reverse()];
  return certifies(game, cycle, body) ? cycle : null;
}

export function certificateFor(game, body) {
  // Imagined futures skip the slow general search on block boards; real moves never do.
  return blockCycle(game, body) ?? (game.laneSim && blockMode(game) ? null : generalCycle(game, body, lanekeeperSettings.generalNodes));
}

// Shortest route to food that drives on the right in every block and only
// enters a block that is unvisited, the same block, or its parent in the tree
// (rooted at the tail). Odd boards use a plain shortest path. Body is static.
function routeTo(game, isTarget) {
  const { size, body, width, height } = game;
  const blockwise = blockMode(game);
  const moves = blockwise ? blockMoves(game) : null, nb = neighborsOf(game);
  let parent = null;
  if (blockwise) {
    parent = new Int32Array(moves.blocks).fill(-1);
    let previous = -2;
    for (let i = body.length - 1; i >= 0; i--) {
      const b = moves.block[body[i]];
      if (parent[b] === -1) parent[b] = previous;
      previous = b;
    }
  }
  // Dijkstra. Block moves are weighted (twanvl's "cell-variant"): returning to
  // the parent block is cheapest and opening a new block dearest, which keeps
  // the block tree compact.
  const { parentCost, sameCost, newCost } = lanekeeperSettings;
  const from = new Int32Array(size).fill(-1), cost = new Float64Array(size).fill(Infinity), done = new Uint8Array(size);
  // Binary heap of (cost, cell) in typed arrays; each cell is pushed at most
  // once per incoming edge, so 4 * size entries always suffice.
  const keys = new Float64Array(4 * size), cells = new Int32Array(4 * size);
  let length = 0;
  const push = (k, v) => {
    let i = length++;
    while (i > 0) { const p = (i - 1) >> 1; if (keys[p] <= k) break; keys[i] = keys[p]; cells[i] = cells[p]; i = p; }
    keys[i] = k; cells[i] = v;
  };
  let d = 0, a = 0;
  const pop = () => {
    d = keys[0]; a = cells[0];
    const k = keys[--length], v = cells[length];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= length) break;
      if (c + 1 < length && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      keys[i] = keys[c]; cells[i] = cells[c]; i = c;
    }
    keys[i] = k; cells[i] = v;
  };
  push(0, body[0]);
  from[body[0]] = body[0]; cost[body[0]] = 0;
  let goal = -1;
  while (length) {
    pop();
    if (done[a]) continue;
    done[a] = 1;
    if (a !== body[0] && isTarget(a)) { goal = a; break; }
    const options = blockwise ? [moves.inside[a], moves.outside[a]] : nb[a];
    for (const b of options) {
      if (b < 0 || done[b] || game.occupied[b]) continue;
      let step = 1;
      if (blockwise) {
        const ba = moves.block[a], bb = moves.block[b];
        if (ba === bb) step = sameCost;
        else if (parent[ba] === bb) step = parentCost;
        else if (parent[bb] === -1) step = newCost;
        else continue;
      }
      if (d + step < cost[b]) { cost[b] = d + step; from[b] = a; push(d + step, b); }
    }
  }
  if (goal === -1) return null;
  const route = [];
  for (let c = goal; c !== body[0]; c = from[c]) route.push(c);
  return route.reverse();
}

// --- Open phase -------------------------------------------------------------
// Boards with an odd side have no 2x2 blocks, so route freely there. A
// route is taken only if, at the moment of eating, the body admits a certified
// cycle; until then the route itself is the proof (no food appears before it
// is eaten). The engine follows the plan and installs the cycle on arrival.
const inOpenPhase = game => !blockMode(game);

// Body after following `route` (which must end on the food), or null.
function simulateRoute(game, route) {
  const nb = neighborsOf(game), body = [...game.body];
  for (let i = 0; i < route.length; i++) {
    const next = route[i], grows = next === game.food;
    if (grows !== (i === route.length - 1) || !nb[body[0]].includes(next)) return null;
    const hit = body.indexOf(next);
    if (hit !== -1 && (grows || hit !== body.length - 1)) return null;
    if (!grows) body.pop();
    body.unshift(next);
  }
  return body;
}

// Shortest routes over the moving body: body cell j (0 = head) is free from
// move k - j on. Eight neighbour orders give differently shaped routes.
function openRoutes(game, maxLength) {
  const { size, body, food } = game, nb = neighborsOf(game), k = body.length;
  const freeAt = new Int32Array(size);
  body.forEach((c, j) => { freeAt[c] = k - j; });
  const routes = [], seen = new Set();
  for (let v = 0; v < 8; v++) {
    const dist = new Int32Array(size).fill(-1), from = new Int32Array(size), queue = [body[0]];
    dist[body[0]] = 0;
    for (let r = 0; r < queue.length && dist[food] < 0; r++) {
      const a = queue[r], options = v & 4 ? nb[a].slice().reverse() : nb[a];
      for (let i = 0; i < options.length; i++) {
        const b = options[(i + v) % options.length];
        if (dist[b] >= 0 || freeAt[b] > dist[a] + 1) continue;
        dist[b] = dist[a] + 1; from[b] = a; queue.push(b);
      }
    }
    if (dist[food] < 0 || dist[food] > maxLength) continue;
    const route = [];
    for (let c = food; c !== body[0]; c = from[c]) route.push(c);
    route.reverse();
    const key = route.join(',');
    if (!seen.has(key)) { seen.add(key); routes.push(route); }
  }
  return routes.sort((a, b) => a.length - b.length);
}

function openMove(game) {
  const { body, food, size } = game;
  const distance = (game.positions[food] - game.positions[body[0]] + size) % size;
  for (const route of openRoutes(game, distance - 1)) {
    const terminal = simulateRoute(game, route);
    if (!terminal) continue;
    const cycle = terminal.length === size ? null : generalCycle(game, terminal, lanekeeperSettings.generalNodes);
    if (terminal.length === size || cycle) {
      game.activePlan = { path: route, cycle, cursor: 0, food };
      game.certifiedRoutes++;
      return route[0];
    }
  }
  if (game.laneBudget > 0) game.laneBudget--;
  return game.cycle[(game.positions[body[0]] + 1) % size];
}

function moved(game, next) {
  return [next, ...(next === game.food ? game.body : game.body.slice(0, -1))];
}

// Strictly decreasing while one apple is pending: free moves count down from
// size + budget; after that, distance to food along the certified cycle.
export function lanekeeperProgress(game) {
  if (game.activePlan) return game.activePlan.path.length - game.activePlan.cursor;
  const budget = game.laneFood === game.food ? game.laneBudget : (lanekeeperSettings.freeBudget ?? game.size);
  return budget > 0 ? game.size + budget : (game.positions[game.food] - game.positions[game.body[0]] + game.size) % game.size;
}

function startApple(game) {
  if (game.laneFood !== game.food) { game.laneFood = game.food; game.laneBudget = lanekeeperSettings.freeBudget ?? game.size; }
}

// Every move the safety rule allows now: legal, certified, and (once the free
// budget is spent) bringing the food strictly closer. `cycle` null = keep.
function safeMoves(game) {
  const { body, food, size } = game, tail = body.at(-1);
  const successor = game.cycle[(game.positions[body[0]] + 1) % size];
  const distance = (game.positions[food] - game.positions[body[0]] + size) % size;
  const moves = [];
  // On block boards only the two drive-on-the-right moves keep the block tree valid.
  const blockwise = blockMode(game);
  const options = blockwise ? [blockMoves(game).inside[body[0]], blockMoves(game).outside[body[0]]].filter(m => m >= 0) : neighborsOf(game)[body[0]];
  for (const m of options) {
    if (game.occupied[m] && !(m === tail && m !== food)) continue;
    if (m === successor) { moves.push({ move: m, cycle: null }); continue; }
    const after = moved(game, m);
    if (after.length === size) { moves.push({ move: m, cycle: null }); continue; }
    const cycle = certificateFor(game, after);
    if (cycle && (game.laneBudget > 0 || m === food || cycle.indexOf(food) < distance)) moves.push({ move: m, cycle });
  }
  return moves;
}

function apply(game, choice) {
  if (game.laneBudget > 0) game.laneBudget--;
  if (choice.cycle) { game.cycle = choice.cycle; game.positions = positionsOf(choice.cycle); game.repairs++; }
  return choice.move;
}

// Small seeded generator for imagined apples (never touches the game's RNG).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Play the base policy forward from `choice`: finish the current apple, then
// `lanekeeperSettings.horizon` imagined apples. Returns the number of moves used.
function simulateFrom(game) {
  return {
    width: game.width, height: game.height, size: game.size, food: game.food,
    body: [...game.body], occupied: Uint8Array.from(game.occupied), cycle: game.cycle, positions: game.positions,
    laneNeighbors: neighborsOf(game), laneBlocks: game.laneBlocks, laneFood: game.laneFood, laneBudget: game.laneBudget, repairs: 0,
    neighbors: c => game.neighbors(c), laneSim: true,
  };
}

// Advance `sim` with `move`, then the base policy, until `apples` more apples
// are eaten (imagined ones drawn from `random`). Returns moves used.
function play(sim, move, apples, random, limit) {
  let steps = 0;
  for (;;) {
    steps++;
    const grows = move === sim.food;
    if (!grows) sim.occupied[sim.body.pop()] = 0;
    sim.body.unshift(move); sim.occupied[move] = 1;
    if (grows) {
      if (--apples === 0 || sim.body.length === sim.size) break;
      // Same imagined apple for every compared move: draw cells until one is free.
      do sim.food = Math.floor(random() * sim.size); while (sim.occupied[sim.food]);
    }
    if (steps >= limit) break;
    startApple(sim);
    move = baseMove(sim);
  }
  return steps;
}

function copySim(sim) {
  return { ...sim, body: [...sim.body], occupied: Uint8Array.from(sim.occupied) };
}

// Move the simulated snake one cell; true if it ate.
function stepSim(sim, move) {
  const grows = move === sim.food;
  if (!grows) sim.occupied[sim.body.pop()] = 0;
  sim.body.unshift(move); sim.occupied[move] = 1;
  return grows;
}

// Branch and bound over the two drive-on-the-right moves (each certified) for
// the fewest moves to the current food. The base policy gives the first bound.
// ponytail: plain DFS capped at maxNodes, add a transposition table if deeper search pays.
function finishSearch(sim, maxNodes) {
  const { size, width } = sim, { inside, outside } = blockMoves(sim);
  const base = copySim(sim);
  let best = play(base, baseMove(base), 1, null, 4 * size), bestSim = base, nodes = 0;
  const fx = sim.food % width, fy = Math.floor(sim.food / width);
  const bound = c => Math.abs(c % width - fx) + Math.abs(Math.floor(c / width) - fy);
  const dfs = (s, depth) => {
    if (++nodes > maxNodes || depth + bound(s.body[0]) >= best) return;
    const head = s.body[0], tail = s.body.at(-1), successor = s.cycle[(s.positions[head] + 1) % size];
    const options = [inside[head], outside[head]].filter(m => m >= 0 && !(s.occupied[m] && !(m === tail && m !== s.food)));
    options.sort((a, b) => bound(a) - bound(b));
    for (const m of options) {
      let cycle = null;
      const after = moved(s, m);
      if (m !== successor && after.length < size && !(cycle = certificateFor(s, after))) continue;
      const n = copySim(s);
      if (cycle) { n.cycle = cycle; n.positions = positionsOf(cycle); }
      if (stepSim(n, m)) { if (depth + 1 < best) { best = depth + 1; bestSim = n; } continue; }
      dfs(n, depth + 1);
    }
  };
  dfs(sim, 0);
  return { steps: best, sim: bestSim };
}

export function chooseLanekeeperMove(game) {
  if (game.food === null) return null;
  startApple(game);
  if (game.activePlan) return game.activePlan.path[game.activePlan.cursor];
  if (inOpenPhase(game)) return openMove(game);
  if (!lanekeeperSettings.samples) return baseMove(game);
  const choices = safeMoves(game);
  if (choices.length < 2) return choices.length ? apply(game, choices[0]) : baseMove(game);
  // Score = moves to finish this apple, plus moves for `horizon` imagined
  // apples, summed over `samples` imagined futures shared by every choice.
  const { samples, horizon } = lanekeeperSettings, limit = 4 * game.size;
  // Stratified imagined apples: free cells in order along the current cycle,
  // one per equal slice (random offset), shared by every compared move.
  let order = null, offset = 0;
  if (lanekeeperSettings.stratified) {
    order = [];
    for (let i = 1, h = game.positions[game.body[0]]; i < game.size; i++) { const c = game.cycle[(h + i) % game.size]; if (!game.occupied[c] && c !== game.food) order.push(c); }
    offset = rng(game.seed * 7919 + game.moves * 31)();
  }
  let best = null, bestCost = Infinity;
  for (const choice of choices) {
    let sim = simulateFrom(game), cost;
    if (lanekeeperSettings.searchNodes) {
      // Fewest moves to the current apple over every certified choice, not just the base policy's.
      const first = apply(sim, choice);
      if (stepSim(sim, first)) cost = samples;
      else { const found = finishSearch(sim, lanekeeperSettings.searchNodes); cost = samples * (1 + found.steps); sim = found.sim; }
    } else cost = samples * play(sim, apply(sim, choice), 1, null, limit);
    const done = sim.body.length === sim.size;
    // Stop once this move can no longer beat the best one (same decision, less work).
    for (let s = 0; s < samples && cost < bestCost && !done && horizon > 0; s++) {
      const random = rng(game.seed * 7919 + game.moves * 31 + s), branch = copySim(sim);
      if (order?.length) {
        let i = Math.floor((s + offset) / samples * order.length);
        for (let k = 0; k < order.length && branch.occupied[order[i]]; k++) i = (i + 1) % order.length;
        branch.food = order[i];
        if (branch.occupied[branch.food]) do branch.food = Math.floor(random() * branch.size); while (branch.occupied[branch.food]);
      } else do branch.food = Math.floor(random() * branch.size); while (branch.occupied[branch.food]);
      startApple(branch);
      cost += play(branch, baseMove(branch), horizon, random, limit);
    }
    if (cost < bestCost) { best = choice; bestCost = cost; }
  }
  return apply(game, best);
}

function baseMove(game) {
  const { body, food, size } = game;
  if (food === null) return null;
  startApple(game);
  const successor = game.cycle[(game.positions[body[0]] + 1) % size];
  const distance = (game.positions[food] - game.positions[body[0]] + size) % size;
  let route = routeTo(game, c => c === food);
  // Look ahead: if following the route would cut blocks off, collect them first.
  if (route && blockMode(game)) {
    const after = route.slice().reverse().concat(body).slice(0, body.length + 1);
    const tree = after.length < size ? blockTree(game, after) : null;
    if (tree?.unreached.length) {
      const { block } = blockMoves(game), lost = new Uint8Array(size);
      for (const b of tree.unreached) lost[b] = 1;
      route = routeTo(game, c => lost[block[c]] === 1) ?? route;
    }
  }
  if (route && route[0] !== successor) {
    const after = moved(game, route[0]);
    const cycle = after.length === size ? null : certificateFor(game, after);
    const closer = route[0] === food || (cycle && cycle.indexOf(food) < distance);
    if (after.length === size || (cycle && (game.laneBudget > 0 || closer))) {
      if (game.laneBudget > 0) game.laneBudget--;
      if (cycle) { game.cycle = cycle; game.positions = positionsOf(cycle); game.repairs++; }
      return route[0];
    }
  }
  if (game.laneBudget > 0) game.laneBudget--;
  return successor;
}
