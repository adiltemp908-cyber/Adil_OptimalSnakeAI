# Adil_OptimalSnakeAI

**The aim is trying to develop a algorithm with the least average moves that can complete the board 100% of the time. The approach followed for this is simple. First priority is the algorithms should complete the board 100% of the time. So first we used Hamiltonian cycle then the next algorithm should retain the garanteed completion while the tweaks made is aimed to reduce average moves. I continued this and greedy+certified hybrid(6th algorithm) was the best performing and then the later two algorithms performed worse.**

**A ninth algorithm, Flexible certificates, was added later. It keeps the guarantee from the very first move, with no unguaranteed greedy phase, and ties Certified routes on average moves. Greedy → certified still uses the fewest moves.**

[Evaluation Results](#evaluation-results)

A browser workbench for nine deterministic Snake algorithms, developed step by step from a fixed Hamiltonian cycle to certified food routes, greedy hybrids, adaptive partial loops, and per-move flexible certificates. Everything runs locally. There is no trained model, dependency installation, or build step.


## Watch the algorithms

[![Eight algorithms on 12×12 at a steady 10 moves per second](docs/media/algorithms-preview.gif)](https://adiltemp908-cyber.github.io/Adil_OptimalSnakeAI/)

**[Watch the full 8-minute 10-second video](https://adiltemp908-cyber.github.io/Adil_OptimalSnakeAI/)** · 12×12 · seed **60021** · **10 moves/sec** · 25% greedy switch.

The video was recorded before Flexible certificates was added, so it shows the first eight algorithms.

Seed 60021 was selected because all eight algorithms finish in the same order as their average-move ranking in the 100-seed comparison below. **Greedy → certified finishes first in 1,759 moves**, followed by Certified routes in 1,863. This representative single run illustrates the ranking; the batch results establish the averages.

Every running algorithm advances exactly once per 0.1 seconds, with no speed ramps, skipped moves, or planning stalls. The run is computed and checked first, then replayed through the real app renderer at fixed frame times, so expensive decisions cannot slow the recording. Finished boards stay still while the others continue at 10 moves/sec. The 20-second GIF excerpt uses the same speed as the full video. The video link opens a dedicated player with playback and fullscreen controls, plus an MP4 download option.

## Goals

- Fill the entire board without collisions and reduce the total number of moves to completion.
- Separate a provably safe continuation from a move that merely looks safe locally.
- Compare policies across reproducible seed batches, reporting failures as well as move counts.
- Make the decisions inspectable: show cycles and planned routes, single-step, rewind, and export results.
- Learn from failed ideas and measure the tradeoff between planning computation and moves saved.

## Run locally

Install Node.js 22 or newer, then:

```sh
git clone https://github.com/adiltemp908-cyber/Adil_OptimalSnakeAI.git
cd Adil_OptimalSnakeAI
npm start
```

Open **http://127.0.0.1:4173**. No `npm install` is required. Stop the server with Ctrl+C.

Choose the board, seed, algorithms, and greedy switch target. Click a board to focus it. Space plays/pauses; Right Arrow steps forward; Left Arrow rewinds; R restarts; Escape leaves the focused view. The app supports even square boards from 2×2 through 40×40, cycle/route overlays, batch benchmarks, and CSV export. Serve the app over HTTP rather than opening `index.html` directly, because it uses JavaScript modules and a worker.

## How we developed the algorithms

1. **Hamiltonian cycle — establish a safe baseline.** Construct one closed route through every cell and follow it. With the body ordered on that cycle, there is always a safe continuation. It eventually fills the board, but takes long detours to nearby food.
2. **Safe shortcuts — skip unnecessary cycle travel.** Jump forward when a neighboring cell preserves body order, does not overtake the tail, and does not pass the food. Account for tail departure and growth separately. This improves efficiency while retaining the original safety invariant.
3. **Dynamic repair — change the route itself.** Split and reconnect cycle edges around grid squares. Keep only complete, body-compatible cycles that shorten the distance to food. We later audited the moving tail and reconsidered repairs every move: the tail can free useful edges between meals.
4. **Compact planner — improve the shape of the remaining route.** Lock every actual body edge into the cycle, keeping the empty cells in a contiguous forward arc. Use bounded local improvement and simulated annealing to search alternative cycles. Only a safe improvement is installed in the live game; the search uses a separate random stream from food placement.
5. **Certified routes — temporarily leave the cycle with a checked return.** Search short food routes, simulate the full moving body and final growth, then find a Hamiltonian cycle compatible with the resulting body. Take the route only when both the route and terminal certificate validate. During playback, replace it only with a strictly shorter, newly certified route. An unsuccessful search preserves the safe fallback.
6. **Greedy → certified — use freedom early, structure later.** While the board is open, chase food with moving-body search, post-food tail-access checks, and an exit-quality tie-breaker. Near a chosen occupancy, seek a compatible full-board cycle and switch permanently to Certified routes. We tested the handoff threshold instead of assuming that longer greedy play would be better. **25% became the practical sweet spot on the tested 12×12 settings.**
7. **Adaptive partial loops — test the natural next idea.** A full-board cycle appeared unnecessarily restrictive, so we tried smaller loops around the body, with shorter routes and expansion when needed. An unrestricted prototype could get stuck near full occupancy. The shipped version instead keeps a checked sequence of reversible merges connecting every omitted region. This restored a completion argument, but the measured expansion costs outweighed the expected move savings.
8. **Greedy → partial loops — combine the experiments.** Reuse the early greedy policy, then require a valid partial-loop expansion certificate before switching. It has the same experimental early phase as Greedy → certified. The comparison below measures whether the easier handoff and local loops actually help overall.
9. **Flexible certificates — keep the guarantee on every move, from the first.** Split the board into 2×2 blocks and keep right inside each block, so every cell has two moves and the visited blocks form a tree whose outline is a full-board cycle (routing idea from twanvl/snake, MIT). Before every move, build and check that cycle for the new position. Give each food a free-move budget, then accept only moves that bring the food strictly closer, so the snake cannot circle forever. To choose between the two moves, search for the fewest moves to the current food and add the cost of 12 imagined next foods spread along the cycle. **It ties Certified routes and stays behind Greedy → certified, but unlike the hybrid it is guaranteed from the first move.**

Along the way, moving-body searches learned to use cells exactly when the tail vacates them. Replanning removed stale detours; equal-length route choices were scored by the exits left after eating. These changes reinforced a central discovery: **the shortest route to the current food need not produce the shortest complete game.** Body shape affects the next choices and the available food cells.

<a id="evaluation-results"></a>

## 12×12 evaluation: all nine algorithms

Fresh evaluation of the published engine: **100 games per algorithm, seeds 60000–60099, initial length 3, greedy target 25%, partial-loop recovery penalty 4**. Every move checks the applicable invariants. This is a new run of the current code, not a mixture of historical versions. Seeds starting at 60000 had appeared in earlier work, so this is a reproducibility/comparison batch rather than a newly reserved holdout.

| Algorithm | Completed | Mean moves | Median | p95 | Fewer moves vs. cycle |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hamiltonian cycle | 100/100 | 5,055.36 | 5,039.5 | 5,521 | Reference |
| Safe shortcuts | 100/100 | 4,745.79 | 4,739 | 5,168 | 6.12% |
| Dynamic repair | 100/100 | 3,238.51 | 3,236.5 | 3,632 | 35.94% |
| Compact planner | 100/100 | 2,020.74 | 2,020.5 | 2,228 | 60.03% |
| Certified routes | 100/100 | 1,806.57 | 1,794.5 | 1,980 | 64.26% |
| Greedy → certified (25%) | 100/100 | 1,776.15 | 1,766 | 1,959 | 64.87% |
| Adaptive partial loops | 100/100 | 2,234.98 | 2,204.5 | 2,649 | 55.79% |
| Greedy → partial loops (25%) | 100/100 | 2,214.80 | 2,197 | 2,533 | 56.19% |
| Flexible certificates † | 100/100 | 1,811.18 | 1,814.5 | 1,970 | 64.17% |

† Run separately on the same seeds and settings, also with every move checked, after Flexible certificates was added: **[flex-12x12-100.json](results/flex-12x12-100.json)**. The engine changes for Flex do not alter the other eight algorithms' decisions, so their rows stand.

Raw per-game outcomes, source hash, settings, and timing: **[comparison-12x12-100.json](results/comparison-12x12-100.json)**.

Move averages, medians, and p95 include completed games only; always read the completion column first. Reduction is relative to the Hamiltonian-cycle mean, not a known optimum. Same seed supplies the same random ranks among each solver's free cells, so food coordinates may diverge. Timing includes planning and verification under concurrent CPU load and is not a controlled speed benchmark.

### Why 25% was the sweet spot for greedy → certified

The earlier threshold simulation produced the following **12×12** results. These belong to the recorded v1.6 engine, separately from the current comparison above.

| Requested handoff | Completed | Mean moves in wins |
| --- | ---: | ---: |
| **25%** | **100/100** | **1,757.77** |
| 35% | 100/100 | 1,783.08 |
| 45% | 100/100 | 1,769.13 |
| 55% | 100/100 | 1,879.08 |
| 65% | 299/300 | 2,097.90 |
| 75% | 97/100 | 2,608.99 |
| 85% | 18/24 | 3,224.78 |
| 95% | 2/8 | 4,037.50 |
| 100% | 1/5 | 4,552.00 |

At low occupancy, greedy routes can collect food cheaply. As the board fills, locally attractive choices can leave awkward body shapes, bottlenecks, and poor exits. The policy then spends moves on recovery or struggles to find a compatible full-board cycle. In that sense, continuing greedy play can force later bad paths: immediate savings create expensive future constraints. This is an interpretation supported by the recovery behavior and threshold results, not a theorem that every later switch is worse.

**25% had the lowest observed mean among the tested settings with at least 100 runs and no failures.** It is an empirical default, not a universal optimum or a guaranteed safe percentage. For example, 45% was better in the separate 8×8 study. The requested occupancy is also not a forced switch: the actual handoff requires a valid certificate and may happen one cell earlier or later during recovery.

The 65% row combines 99/100 in the initial screen with 200/200 on additional seeds; the later successes do not erase the failure. High-threshold screening stopped submitting new runs after repeated failures, so those samples are smaller and subject to optional stopping. All reported failures reached the native 20,163-move budget; wall-clock cutoffs were excluded. **[Threshold evidence and provenance](results/hybrid-threshold-12x12.json)**.

We also disabled handoff entirely in a separate 100-seed study. Pure greedy with local safety checks completed only **46/100**, averaging **4,021.20 moves in wins**; the other 54 reached the move budget. The mean final length was **142.77/144**. Being almost full—and retaining local tail access—did not imply efficient completion. **[Pure-greedy results](results/pure-greedy-12x12-100-seed-0.json)**.

### Why partial loops looked promising but performed worse

A small loop seemed like the natural next progression: if nearby food can be reached without carrying a full-board cycle, perhaps the solver can be more direct and restore distant regions only when needed. The missing cost was **reconnection**.

- Food can appear outside the current loop. Before expanding, the tail must clear the bridge edge; meanwhile the snake may have to circulate without making useful food progress.
- A loop that is good for this meal can be badly positioned for the next one. Splitting and restoring regions repeatedly consumes the apparent shortcut savings.
- A locally safe loop alone is insufficient. Keeping explicit expansion certificates preserves access to omitted regions, but constrains the moves that can be taken safely.

After tuning, we evaluated 100 reserved seeds, **50000–50099**, on 12×12:

| Solver | Completed | Mean moves |
| --- | ---: | ---: |
| Certified routes | 100/100 | 1,795.97 |
| Greedy → certified, 25% | 100/100 | 1,769.77 |
| Adaptive partial loops | 100/100 | 2,221.13 |

Partial loops spent **679.73 moves per game clearing expansion bridges—about 31% of all moves**. They used **23.67% more moves than Certified routes** and **25.50% more than Greedy → certified** on this held-out set. Reliability was encouraging; efficiency was worse. **[Held-out results](results/partial-validation-12x12.json)**.

We tried penalizing expansion costs, preferring bridges that avoid body edges, and scoring likely next-food access. In a separate 20-seed tuning batch, rejecting locally shorter routes with worse estimated next-food cost reduced the mean from 2,380.95 to 2,234.35 moves, but did not overturn the held-out conclusion. We never read the next food or future RNG state. A weaker local constraint created more freedom, but using that freedom well required better long-term planning.

### Flexible certificates: guaranteed from the first move

Greedy → certified gets its lead from an early phase without a guarantee. Flexible certificates asks whether a solver can stay certified from the first move and still compete. The 2×2 block rule makes a full-board cycle cheap to build and check on every move, because the visited blocks always form a tree whose outline is that cycle.

Flex was tuned on seeds 200–239 and 300–339 (40 games each), then run on the comparison seeds above:

| Seeds | Flexible certificates | Certified routes | Greedy → certified |
| --- | ---: | ---: | ---: |
| 200–239 | 1,791 | 1,828 | 1,759 |
| 300–339 | 1,802 | 1,799 | 1,769 |
| 60000–60099 | 1,811.18 | 1,806.57 | 1,776.15 |

Across the 180 games, Flex and Certified routes are within about 0.3% of each other, inside seed-to-seed noise. On the 100 comparison seeds, Flex uses 4.6 more moves per game than Certified routes (standard error 13.8) and 35.0 more than Greedy → certified (standard error 14.4). Food coordinates diverge between solvers, so this pairing is only approximate.

Where the moves go, from a 10-game profile on seeds 200–209 (moves per food by snake length):

| Snake length | 0–23 | 24–47 | 48–71 | 72–95 | 96–119 | 120+ |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Flexible certificates | 10.6 | **13.3** | **15.7** | **15.4** | 14.0 | 5.7 |
| Certified routes | 9.5 | 14.3 | 16.9 | 16.9 | 13.3 | **5.6** |
| Greedy → certified | **8.7** | 13.5 | 16.9 | 17.2 | **12.0** | 5.8 |

Flex is best in the middle of the game, where the compact block tree keeps many shortcuts certifiable. It loses early, where the keep-right rule adds about two moves per food compared with a direct route. Ten games is a small sample, so read the bands as a direction rather than exact values.

The early loss is the price of the mid-game gain. We tried a free early phase followed by re-alignment to the blocks, a Certified-routes opening followed by Flex (hand-off at length 12, 24, or 36), and Flex followed by Certified routes late (hand-off at 72, 96, or 120). The openings improved the first foods but left a sprawling block tree that cost more over the next ~50 foods. The late hand-offs made no measurable difference. More look-ahead also stopped paying: 24 or 48 imagined foods, a 30,000-position search, and two foods of look-ahead were all no better than the shipped settings.

## Safety and limitations

Algorithms 1–5 maintain a full-board cycle or a collision-free route to a verified terminal cycle. Under this project's rules, the associated progress measure gives a completion argument. Adaptive partial loops instead keep a verified expansion chain and have a larger bound because bridges may require waiting. Flexible certificates (algorithm 9) checks a full-board cycle before every move and uses a per-food progress measure, giving a completion argument with a larger bound of `(N - 3) × (2N - 1)` moves. The greedy phases in algorithms 6 and 8 use local checks and **do not guarantee full-game completion**.

The rules are an obstacle-free grid, no wrapping, stationary food until eaten, and growth by one cell. Cycle construction requires at least one even dimension; the UI exposes even squares. A reported 100/100 is evidence about that sample, not proof of universal reliability. See **[algorithm invariants and bounds](docs/ALGORITHMS.md)**.

## Reproduce the evaluation

From the repository root:

```sh
# All eight algorithms, 100 shared seeds, every-move verification.
node scripts/partial-study.mjs --count=100 --side=12 --seed=60000 --penalties=4 --algorithms=cycle,shortcut,repair,compact,certified,hybrid,partial,greedy_partial --workers=4 --out=artifacts/comparison-12x12-100.json

# A small verified comparison, or select individual algorithm IDs.
node scripts/benchmark.mjs 5 12 42 --verify

# Re-run threshold screening (current engine; historical numbers may differ).
node scripts/hybrid-sweep.mjs --count=100 --side=12 --seed=10000 --thresholds=25,35,45,55,65,75,85,95,100 --workers=4 --max-ms=0 --out=artifacts/hybrid-screen-12x12.json

# Flexible certificates on the same 100 seeds, every move verified.
node scripts/partial-study.mjs --count=100 --side=12 --seed=60000 --penalties=4 --algorithms=flex --workers=4 --out=artifacts/flex-12x12-100.json

# Greedy food routing with certification handoff disabled.
node scripts/pure-greedy-study.mjs 100 12 0 4

# Full suite, including the longer multi-board regression.
npm test
```

For a shorter regression run that excludes only the expensive multi-board bulk case:

```sh
node --test --test-skip-pattern="all nine default solvers complete regression seeds" tests/*.test.mjs
```

The publication check passed all **43 selected tests**, covering certificates, moving-tail routing, handoffs, partial-loop expansion, deterministic decisions, rewind/replay, benchmark selection, and checkpoint writes. The long bulk regression was not rerun for publication; the fresh 800-game 12×12 comparison separately validates every move. Browser checks cover eight completed seed-42 games and the mobile layout.

After Flexible certificates was added, the full suite passed all **48 tests**, including the multi-board bulk regression, which now runs Flex on every board size in it, odd sides included. In the browser, all nine seed-42 games completed.

## Repository contents

| Path | Purpose |
| --- | --- |
| `dist/` | Hand-authored browser app and shared solver modules; these are the actual source files, not disposable build output. |
| `scripts/` | Local server and reproducible evaluation utilities. |
| `tests/` | Regression tests and the small position fixtures they require. |
| `results/` | The selected datasets supporting this README. Historical files retain their recorded source hashes. |
| `docs/` | Safety explanation, demo video, and preview. |

Generated benchmarks go to ignored `artifacts/`. Local caches, hosting metadata, logs, CPU profiles, temporary recordings, unrelated reports, and duplicate source snapshots are excluded from this repository.
