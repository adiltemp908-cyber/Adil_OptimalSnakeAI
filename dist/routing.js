// Bounded A* over actual moving bodies. Initial occupied cells can be entered
// after the tail releases them; newly occupied path cells still block the head.
// No future food or random draws are consulted. Search exhaustion is inconclusive.
// Cell IDs are below 1600. One UTF-16 code unit per cell is an exact, collision-
// free body key, avoiding decimal conversion at every expanded search node.
const bodyKey = body => String.fromCharCode(...body);
export function movingFoodRoutes(game, { maxLength = game.size - 1, maxNodes = 1200, variants = 8, acceptBody = () => true } = {}) {
  const neighbors = game.routeNeighbors ??= Array.from({ length: game.size }, (_, cell) => game.neighbors(cell));
  const distance = cell => Math.abs(cell % game.width - game.food % game.width) + Math.abs(Math.floor(cell / game.width) - Math.floor(game.food / game.width));
  if (game.food === null || distance(game.body[0]) > maxLength) return [];
  const paths = [], unique = new Set();
  for (let variant = 0; variant < variants; variant++) {
    const directions = [-1, 1, -game.width, game.width];
    if (variant & 4) directions.reverse();
    const order = directions.slice(variant % 4).concat(directions.slice(0, variant % 4));
    let serial = 0;
    const better = (a, b) => a.f - b.f || b.steps - a.steps || a.serial - b.serial;
    const heap = [];
    const push = node => {
      let i = heap.length; heap.push(node);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (better(heap[parent], node) <= 0) break;
        heap[i] = heap[parent]; i = parent;
      }
      heap[i] = node;
    };
    const pop = () => {
      const result = heap[0], last = heap.pop();
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && better(heap[child + 1], heap[child]) < 0) child++;
          if (better(last, heap[child]) <= 0) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = last;
      }
      return result;
    };
    push({ body: game.body, steps: 0, f: distance(game.body[0]), parent: null, serial: serial++ });
    const visited = new Map([[bodyKey(game.body), 0]]);
    let expanded = 0;
    while (heap.length && expanded++ < maxNodes) {
      const node = pop(), head = node.body[0];
      if (head === game.food) {
        if (!acceptBody(node.body)) continue;
        const path = [];
        for (let current = node; current.parent; current = current.parent) path.push(current.body[0]);
        path.reverse();
        const key = path.join(',');
        if (!unique.has(key)) { unique.add(key); paths.push(path); }
        break;
      }
      const options = neighbors[head].slice().sort((a, b) => order.indexOf(a - head) - order.indexOf(b - head));
      for (const next of options) {
        const grows = next === game.food, steps = node.steps + 1, f = steps + distance(next);
        if (f > maxLength) continue;
        const occupied = node.body.indexOf(next);
        if (occupied !== -1 && (grows || occupied !== node.body.length - 1)) continue;
        const body = [next, ...(grows ? node.body : node.body.slice(0, -1))], key = bodyKey(body);
        if ((visited.get(key) ?? Infinity) <= steps) continue;
        visited.set(key, steps);
        push({ body, steps, f, parent: node, serial: serial++ });
      }
    }
  }
  return paths;
}

// Rank equal-length meals by access to possible next food cells. This averages
// over current empty cells, not the actual next RNG draw. Body cells other than
// the departing tail are blocked, so this is a conservative shape heuristic.
export function foodExitCost(game, body) {
  if (body.length === game.size) return 0;
  const blocked = new Uint8Array(game.size);
  for (const cell of body) blocked[cell] = 1;
  blocked[body.at(-1)] = 0;
  const distances = new Int32Array(game.size).fill(-1), queue = [body[0]];
  distances[body[0]] = 0;
  for (let read = 0; read < queue.length; read++) for (const next of game.neighbors(queue[read])) {
    if (!blocked[next] && distances[next] === -1) { distances[next] = distances[queue[read]] + 1; queue.push(next); }
  }
  const occupied = new Set(body);
  let cost = 0;
  for (let cell = 0; cell < game.size; cell++) if (!occupied.has(cell)) cost += distances[cell] < 0 ? 2 * game.size : distances[cell];
  return cost;
}
