# Certificates, progress, and the moving tail

## Full-board cycles

For a board with `N` cells, a Hamiltonian cycle visits every cell once and returns to its start. Reading the snake from head to tail, the cycle positions remain ordered so that the tail is the first occupied cell ahead of the head. The successor is either empty or the tail cell departing on this move. On a growth move the tail does not depart, so that exception is unavailable.

The fixed-cycle and shortcut policies preserve this order. A shortcut cannot pass the current food or overtake the tail. Dynamic repair may replace the cycle only after checking full coverage, adjacency, body order, and a strictly shorter forward food distance.

Compact planning uses a stronger invariant: every actual body edge is locked into the cycle. The body is a contiguous segment, and all free cells lie in the forward head-to-tail arc. Internal annealing proposals may explore worse cycles; only a safe improvement changes the live game. Reconsidering the cycle after each move exploits edges newly released by the tail.

## Certified routes

A candidate food route is simulated with the complete moving body, including the final growth step. Its terminal body must fit a verified full-board cycle. The route must be strictly shorter than the current safe route. A route that fills the board needs no terminal cycle.

While off-cycle, the remaining committed route supplies the safe continuation; the displayed cycle belongs to its terminal state. New plans replace it only if strictly shorter and independently certified. On reaching the food, the terminal cycle is installed. Search exhaustion leaves the current plan or fallback intact.

For algorithms 1–5, use forward cycle distance to the current food, or remaining committed moves while on a certified route, as the progress measure. Every move reduces it; accepted repairs and route replacements reduce it too. With initial length 3, a loose whole-game bound is `(N - 3) × (N - 1)`. For 12×12, this is 20,163 moves.

## Greedy handoff

Early greedy play checks exact collision-free food routes and head-to-tail access after eating, with exit quality breaking equal-length ties. These local checks are insufficient to prove eventual board completion. Recovery can repeat or lead to difficult certification states.

Near the occupancy target, Greedy → certified requires a validated Hamiltonian cycle; Greedy → partial loops requires a validated expansion certificate. Neither installs a certificate merely because it reached the requested length. The handoff can occur one cell early or later during recovery. After successful handoff, the corresponding certified policy applies, subject to the run's remaining budget.

The early greedy phase uses 20,163 moves as an experimental cap on 12×12, not a proven bound for the heuristic. Non-completions remain visible in the results.

## Partial-loop expansion certificates

The snake is a contiguous segment of a directed simple local cycle. Other cells belong to disjoint empty cycles. The certificate records square-edge merges from the body loop through all omitted components, so reversing the recorded splits can restore a full-board cycle. A local head-to-tail path without this expansion record is insufficient.

A merge replaces one edge in each of two loops with two grid-adjacent connections and preserves the orientation of retained child edges. It can be installed only when it preserves all actual body edges. If food is outside the current loop, following that loop cannot grow the snake; within at most a lap, the connecting edge is no longer internal to the body. This remains true if the body fills the loop: the free head-to-tail edge rotates until it reaches the bridge.

Restore parents until the food is on the live loop. Then successor moves and accepted splits shorten forward food distance. Direct food routes must terminate in another valid expansion certificate or a full-board win, and replacements must be strictly shorter. Bounded search failure retains the existing safe plan.

Every detached grid cycle contains at least four cells. A loose per-food bound is `floor(N / 4) × (N - 1)`; multiply by `N - 3` for the whole game. The larger bound reflects real waiting costs, not improved efficiency. In the recorded held-out 12×12 experiment, no partial-loop game needed the extra allowance: all completed within 2,862 moves, below the smaller 20,163-move budget as well.

## Flexible certificates

On boards with two even sides, the grid is split into 2×2 blocks. Inside each block the snake always turns the same way (keep right), so every cell has exactly two legal moves: stay in the block or cross into the next one. The blocks the body has passed through form a tree, and the outline of a spanning tree of blocks is a Hamiltonian cycle. This makes a certificate cheap to build. The keep-right routing inside 2×2 blocks comes from twanvl/snake (MIT licence).

Before every move, the solver builds a Hamiltonian cycle for the body after that move and checks it cell by cell (`certifies` in `dist/flex.js`). The cycle must start at the head, continue through every free cell, and end with the body in reverse order. This is the compact invariant used by Certified routes. If no move toward food gets a valid cycle, the snake takes the successor on its current cycle, which keeps the invariant. A certified state therefore always has a safe continuation, and following its cycle fills the board.

Each food starts with a budget of `N` free moves. While budget remains, any certified move is allowed and the progress measure is `N` plus the remaining budget. After that, a move is accepted only if the food is strictly closer along the new cycle, and the progress measure is that forward distance, below `N`. The measure falls on every move, so one food costs at most `N + (N - 1) = 2N - 1` moves and the whole game at most `(N - 3) × (2N - 1)`. For 12×12 this is 40,467 moves; the engine uses it as Flex's move budget. In the recorded 12×12 run, the 95th percentile was 1,970 moves.

To choose between the two allowed moves, the solver works on copies of the game. For each move it searches up to 3,000 positions for the fewest moves to the current food, then adds the cost of 12 imagined next foods spread evenly over the free cells along the cycle. Every compared move uses the same imagined foods. They come from a separate seeded generator and never draw from the food PRNG.

Boards with an odd side have no 2×2 blocks. There, Flex searches for a general cycle (up to 2,000 nodes), plans food routes strictly shorter than the cycle distance, and commits to a route only when the body at the food has a verified cycle. The committed route is checked like a Certified route.

There is no unguaranteed phase: the certificate holds from the first move.

## Scope and reproducibility

These arguments assume an obstacle-free rectangle, both dimensions at least two, at least one even dimension, no wrapping, stationary food until eaten, one-cell growth, and no external time limit. They do not certify arbitrary imported snake states or global move optimality.

Each solver has an identical seeded food PRNG and draws one random rank among its own free cells per food. Same seed does not mean identical later food coordinates. Planning uses separate randomness and does not peek at future food. Completion rates, move counts, and planning time answer different questions; report all outcomes and interpret wins-only means alongside completion counts.
