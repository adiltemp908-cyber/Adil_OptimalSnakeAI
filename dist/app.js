import { SnakeGame, ALGORITHMS, LABELS, summarize } from './engine.js';
import { PlaybackGroup } from './playback.js';
import { validSquareSide, MIN_SIDE, MAX_SIDE } from './board-size.js';
const $ = id => document.getElementById(id);
const COLORS = { cycle: '#a9cd7e', shortcut: '#83c9c5', repair: '#e0ba88', compact: '#bdabe1', certified: '#e99da7', hybrid: '#8ab8e6', partial: '#e3cf78', greedy_partial: '#e7a5d4' };
const TAGS = { cycle: 'BASELINE', shortcut: 'SHORTCUTS', repair: 'ADAPTIVE', compact: 'PLANNED', certified: 'VERIFIED', hybrid: 'EXPERIMENTAL', partial: 'REVERSIBLE', greedy_partial: 'EXPERIMENTAL' };
const number = value => Math.round(value).toLocaleString();
let games = [], timeline, running = false, finishing = false, lastTime = 0, accumulator = 0, worker = null, rows = [], batch = null;
let laterOnly = false, focusedAlgorithm = null;
let enabledAlgorithms = [...ALGORITHMS];
try {
  const saved = JSON.parse(localStorage.getItem('snake-lab-algorithms'));
  if (Array.isArray(saved)) {
    const enabled = ALGORITHMS.filter(id => saved.includes(id));
    if (enabled.length) enabledAlgorithms = enabled;
  }
} catch {}
const selectedAlgorithms = () => focusedAlgorithm ? [focusedAlgorithm] : enabledAlgorithms.filter(id => !laterOnly || ALGORITHMS.indexOf(id) >= 3);
$('algorithm-options').innerHTML = ALGORITHMS.map((id, i) => `<label><input type="checkbox" value="${id}" ${enabledAlgorithms.includes(id) ? 'checked' : ''}>${i + 1}. ${LABELS[id]}</label>`).join('');
function selectAlgorithms(ids) {
  if (!ids.length) return;
  enabledAlgorithms = ALGORITHMS.filter(id => ids.includes(id));
  try { localStorage.setItem('snake-lab-algorithms', JSON.stringify(enabledAlgorithms)); } catch {}
  $('algorithm-options').querySelectorAll('input').forEach(input => { input.checked = enabledAlgorithms.includes(input.value); });
  if (worker) stopBenchmark('Stopped after algorithm selection changed · completed results retained');
  laterOnly = false;
  changeView();
  renderBenchmark();
}
$('algorithm-options').addEventListener('change', event => {
  const ids = [...$('algorithm-options').querySelectorAll('input:checked')].map(input => input.value);
  if (!ids.length) { event.target.checked = true; return; }
  selectAlgorithms(ids);
});
$('algorithms-all').addEventListener('click', () => selectAlgorithms(ALGORITHMS));
$('algorithms-latest').addEventListener('click', () => selectAlgorithms(['partial', 'greedy_partial']));

$('boards').innerHTML = ALGORITHMS.map((algorithm, i) => `<article class="board-card" data-algorithm="${algorithm}" aria-label="${LABELS[algorithm]}"><div class="card-heading"><span class="card-number">0${i + 1}</span><h2>${LABELS[algorithm]}</h2><span class="tag">${TAGS[algorithm]}</span></div><div class="board-wrap"><canvas id="canvas-${algorithm}" width="640" height="640" role="img" aria-label="${LABELS[algorithm]} game board"></canvas><span class="win-badge" id="win-${algorithm}" hidden>✓ Board complete</span></div><div class="card-metrics"><div><span class="metric-label">TOTAL MOVES</span><strong class="move-count" id="moves-${algorithm}">0</strong></div><div class="fill-metric"><span class="metric-label">BOARD FILLED</span><span class="fill-count" id="fill-${algorithm}"></span></div></div><div class="fill-track"><span id="track-${algorithm}"></span></div><div class="card-bottom"><span class="action" id="action-${algorithm}">Following the cycle</span><span class="event-count" id="events-${algorithm}"></span></div></article>`).join('');
const contexts = Object.fromEntries(ALGORITHMS.map(a => [a, $(`canvas-${a}`).getContext('2d')]));
for (const algorithm of ALGORITHMS) {
  const card = document.querySelector(`[data-algorithm="${algorithm}"]`);
  const button = document.createElement('button');
  button.id = `expand-${algorithm}`; button.className = 'expand-board'; button.type = 'button';
  button.setAttribute('aria-label', `Expand ${LABELS[algorithm]}`);
  button.setAttribute('aria-expanded', 'false'); button.title = `Expand ${LABELS[algorithm]}`;
  button.textContent = '⤢'; card.querySelector('.card-heading').append(button);
}

function changeView(algorithm = null) {
  const previous = focusedAlgorithm;
  focusedAlgorithm = algorithm;
  if (algorithm) $('algorithm-picker').open = false;
  running = false; finishing = false; accumulator = 0;
  timeline.select(selectedAlgorithms());
  document.body.classList.toggle('focused-view', Boolean(algorithm));
  $('boards').classList.toggle('is-focused', Boolean(algorithm));
  update();
  if (algorithm) window.scrollTo({ top: 0 });
  else $('viewer-controls').scrollIntoView({ block: 'start' });
  if (algorithm) $('exit-focus').focus({ preventScroll: true });
  else if (previous && selectedAlgorithms().includes(previous)) $(`expand-${previous}`).focus({ preventScroll: true });
}

function settings() {
  const custom = $('board').value === 'custom';
  const sizeInput = $('custom-size');
  const side = Number(custom ? sizeInput.value : $('board').value);
  sizeInput.setCustomValidity('');
  if (!validSquareSide(side)) {
    sizeInput.setCustomValidity(`Enter an even side length from ${MIN_SIDE} to ${MAX_SIDE}. These solvers require an even square grid.`);
    sizeInput.reportValidity();
    return null;
  }
  const input = $('seed');
  if (input.value.trim() === '' || !input.checkValidity()) {
    input.setCustomValidity('Enter a whole-number seed from 0 to 4,294,967,295.');
    input.reportValidity();
    return null;
  }
  return { width: side, height: side, seed: Number(input.value) >>> 0, hybridThreshold: Number($('hybrid-threshold').value) };
}

function reset(onlySelected = false) {
  const config = settings();
  if (!config) return;
  if (onlySelected && timeline) {
    for (const algorithm of selectedAlgorithms()) timeline.replace(new SnakeGame({ ...config, algorithm }));
  } else timeline = new PlaybackGroup(ALGORITHMS.map(algorithm => new SnakeGame({ ...config, algorithm })));
  timeline.select(selectedAlgorithms());
  games = timeline.games;
  running = false; finishing = false; accumulator = 0;
  update();
}

function drawBoard(game) {
  const ctx = contexts[game.algorithm], canvas = ctx.canvas, n = game.width;
  const W = canvas.width, padding = 19, cell = (W - padding * 2) / n;
  const point = value => [padding + (value % n + .5) * cell, padding + (Math.floor(value / n) + .5) * cell];
  ctx.clearRect(0, 0, W, W);
  ctx.fillStyle = '#20271f'; ctx.fillRect(0, 0, W, W);
  ctx.strokeStyle = '#30392d'; ctx.lineWidth = 1;
  for (let i = 0; i <= n; i++) {
    const p = padding + cell * i;
    ctx.beginPath(); ctx.moveTo(p, padding); ctx.lineTo(p, W - padding); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padding, p); ctx.lineTo(W - padding, p); ctx.stroke();
  }
  const usesPartial = game.algorithm === 'partial' || (game.algorithm === 'greedy_partial' && game.hybridPhase === 'partial');
  const greedy = ['hybrid', 'greedy_partial'].includes(game.algorithm) && !['certified', 'partial'].includes(game.hybridPhase);
  if ($('show-cycle').checked && (!greedy || game.activePlan?.cycle || game.activePlan?.loop)) {
    ctx.strokeStyle = '#49583e'; ctx.lineWidth = Math.max(1.2, cell * .04); ctx.beginPath();
    ((usesPartial || game.activePlan?.loop) ? (game.activePlan?.loop ?? game.partialLoop ?? []) : (game.activePlan?.cycle ?? game.cycle)).forEach((value, index) => { const [x, y] = point(value); if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.closePath(); ctx.stroke();
  }
  const color = COLORS[game.algorithm];
  // Draw the connected body as a stroke plus cells for an unambiguous grid view.
  if (game.body.length > 1) {
    ctx.strokeStyle = color; ctx.globalAlpha = .7; ctx.lineWidth = cell * .62; ctx.lineJoin = 'round'; ctx.beginPath();
    game.body.forEach((value, index) => { const [x, y] = point(value); if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke(); ctx.globalAlpha = 1;
  }
  for (let i = game.body.length - 1; i >= 0; i--) {
    const [x, y] = point(game.body[i]);
    const s = cell * .77;
    ctx.fillStyle = i === 0 ? '#e6f0cd' : color;
    ctx.globalAlpha = i === 0 ? 1 : .62 + .26 * (1 - i / game.body.length);
    ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, cell * .14); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (game.activePlan && $('show-cycle').checked) {
    ctx.strokeStyle = '#f5efdf'; ctx.lineWidth = Math.max(2, cell * .08); ctx.setLineDash([cell * .14, cell * .12]); ctx.beginPath();
    const route = [game.body[0], ...game.activePlan.path.slice(game.activePlan.cursor)];
    route.forEach((value, i) => { const [x, y] = point(value); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
  }
  const [hx, hy] = point(game.body[0]);
  const neck = game.body[1] ?? game.body[0];
  const dx = game.body[0] % n - neck % n, dy = Math.floor(game.body[0] / n) - Math.floor(neck / n);
  ctx.fillStyle = '#35452c';
  for (const sign of [-1, 1]) {
    ctx.beginPath(); ctx.arc(hx + dx * cell * .15 - dy * sign * cell * .16, hy + dy * cell * .15 + dx * sign * cell * .16, Math.max(1.5, cell * .05), 0, Math.PI * 2); ctx.fill();
  }
  if (game.food !== null) {
    const [x, y] = point(game.food);
    ctx.fillStyle = '#e5896c'; ctx.beginPath(); ctx.arc(x, y + cell * .02, cell * .22, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#d4dfbd'; ctx.lineWidth = Math.max(1.6, cell * .045); ctx.beginPath(); ctx.moveTo(x, y - cell * .17); ctx.lineTo(x + cell * .07, y - cell * .32); ctx.stroke();
  }
}

function drawChart() {
  const chartGames = timeline.activeGames;
  const width = 680, height = 165, left = 43, right = 18, top = 12, bottom = 27;
  const max = Math.max(100, ...chartGames.map(g => g.moves));
  const x = moves => left + moves / max * (width - left - right);
  const y = fill => top + (1 - fill) * (height - top - bottom);
  let svg = `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true">`;
  for (const tick of [0, .5, 1]) svg += `<line x1="${left}" y1="${y(tick)}" x2="${width - right}" y2="${y(tick)}" stroke="#e6e9dd" stroke-dasharray="3 4"/><text x="${left - 8}" y="${y(tick) + 3}" text-anchor="end">${tick * 100}%</text>`;
  for (let i = 0; i < 5; i++) svg += `<text x="${x(max * i / 4)}" y="${height - 9}" text-anchor="middle">${number(max * i / 4)}</text>`;
  for (const game of chartGames) {
    // Step plot: the board grows only when food is eaten.
    let path = `M ${x(0)} ${y(3 / game.size)}`;
    for (const [moves, length] of game.history.slice(1)) path += ` H ${x(moves)} V ${y(length / game.size)}`;
    path += ` H ${x(game.moves)}`;
    svg += `<path d="${path}" fill="none" stroke="${COLORS[game.algorithm]}" stroke-width="2.5"/><circle cx="${x(game.moves)}" cy="${y(game.body.length / game.size)}" r="3" fill="${COLORS[game.algorithm]}"/>`;
  }
  svg += `<text x="${width - right}" y="${height - 9}" text-anchor="end" opacity="0">moves</text></svg>`;
  $('chart').innerHTML = svg;
}

function update() {
  const selected = selectedAlgorithms(), active = timeline.activeGames;
  $('view-title').textContent = focusedAlgorithm ? LABELS[focusedAlgorithm] : `${selected.length} selected algorithms`;
  $('selection-count').textContent = `${enabledAlgorithms.length} of ${ALGORITHMS.length} enabled`;
  $('algorithm-options').querySelectorAll('input').forEach(input => { input.disabled = enabledAlgorithms.length === 1 && input.checked; });
  $('later-only').disabled = !enabledAlgorithms.some(id => ALGORITHMS.indexOf(id) >= 3);
  $('view-scope').textContent = focusedAlgorithm ? 'Controls affect this algorithm. Other games are paused.' : `Controls affect the ${selected.length} visible algorithms. Click a board to expand it.`;
  $('later-only').textContent = laterOnly ? 'Show all selected' : 'Hide first three';
  $('later-only').setAttribute('aria-pressed', String(laterOnly));
  $('exit-focus').hidden = !focusedAlgorithm;
  $('reset').title = focusedAlgorithm ? `Restart ${LABELS[focusedAlgorithm]} (R)` : 'Restart visible algorithms (R)';
  $('reset').setAttribute('aria-label', $('reset').title);
  document.querySelectorAll('.chart-legend > span').forEach((span, i) => { span.hidden = !selected.includes(ALGORITHMS[i]); });
  $('chart').setAttribute('aria-label', `Board occupancy versus moves for ${selected.map(id => LABELS[id]).join(', ')}`);
  for (const game of games) {
    const a = game.algorithm;
    const card = document.querySelector(`[data-algorithm="${a}"]`);
    card.hidden = !selected.includes(a);
    $(`expand-${a}`).textContent = focusedAlgorithm === a ? '⤡' : '⤢';
    $(`expand-${a}`).setAttribute('aria-expanded', String(focusedAlgorithm === a));
    $(`expand-${a}`).setAttribute('aria-label', focusedAlgorithm === a ? 'Back to comparison' : `Expand ${LABELS[a]}`);
    $(`expand-${a}`).title = $(`expand-${a}`).getAttribute('aria-label');
    if (!card.hidden) drawBoard(game);
    $(`moves-${a}`).textContent = number(game.moves);
    $(`fill-${a}`).innerHTML = `${(game.body.length / game.size * 100).toFixed(0)}%<small> · ${game.body.length}/${game.size}</small>`;
    $(`track-${a}`).style.width = `${game.body.length / game.size * 100}%`;
    $(`action-${a}`).textContent = game.lastAction;
    $(`action-${a}`).title = game.lastAction;
    $(`events-${a}`).textContent = a === 'cycle' ? 'Fixed route' : a === 'shortcut' ? `${number(game.shortcuts)} shortcuts` : a === 'certified' ? `${number(game.certifiedRoutes)} routes` : `${number(game.repairs)} repairs`;
    if (a === 'certified') $(`events-${a}`).title = `${game.certifiedReplans} certified route revisions during play`;
    if (a === 'partial' || (a === 'greedy_partial' && game.hybridPhase === 'partial')) {
      const loop = game.activePlan?.loop ?? game.partialLoop;
      $(`events-${a}`).textContent = loop ? `Loop ${loop.length}/${game.size} · ${game.partialRoutes} routes` : 'Full board';
      $(`events-${a}`).title = `${game.partialSplits} local splits, ${game.partialMerges} expansions, ${game.partialRecoveryMoves} moves clearing bridges, ${game.partialReplans} route revisions. The overlay shows the terminal loop during a planned route.`;
    }
    if (a === 'hybrid' || (a === 'greedy_partial' && game.hybridPhase !== 'partial')) {
      $(`events-${a}`).textContent = game.hybridPhase === 'certified' ? `Certified · from ${game.hybridSwitchActualLength} cells` : `${game.hybridPhase === 'handoff' ? 'Handoff' : 'Greedy'} · target ${game.hybridSwitchLength}`;
      $(`events-${a}`).title = (game.hybridSwitchMove === null ? 'Switch only when a compatible cycle is verified. The target may be exceeded.' : `Switched at length ${game.hybridSwitchActualLength}, move ${game.hybridSwitchMove}.`) + ` ${game.greedyReplans} greedy and ${game.certifiedReplans} certified route revisions.`;
    }
    $(`win-${a}`).hidden = game.status !== 'won';
  }
  const done = active.every(g => g.status !== 'running');
  if (done) { running = false; finishing = false; }
  $('play').innerHTML = running ? '<span aria-hidden="true">Ⅱ</span> Pause' : `<span aria-hidden="true">▶</span> ${done ? 'Run again' : active.some(g => g.moves) ? 'Resume' : focusedAlgorithm ? 'Run algorithm' : 'Run comparison'}`;
  $('play').disabled = Boolean(worker);
  $('step').disabled = running || done || Boolean(worker);
  $('step-back').disabled = !timeline.canStepBack || Boolean(worker);
  $('finish').disabled = done || Boolean(worker) || finishing;
  const completed = active.filter(g => g.status === 'won').length;
  const failed = active.some(g => ['failed', 'timeout'].includes(g.status));
  const status = failed ? `INCOMPLETE BOARD · ${completed}/${active.length} COMPLETE` : done ? focusedAlgorithm ? 'BOARD COMPLETE' : `ALL ${completed} BOARDS COMPLETE` : running ? finishing ? 'FINISHING VISIBLE RUNS…' : `RUNNING · ${completed}/${active.length} COMPLETE` : active.some(g => g.moves) ? 'PAUSED' : 'READY WHEN YOU ARE';
  if ($('run-status').textContent !== status) $('run-status').textContent = status;
  if (done && !failed) {
    const best = [...active].sort((a, b) => a.moves - b.moves)[0];
    const hasBaseline = games[0].status === 'won';
    const reduction = hasBaseline ? (1 - best.moves / games[0].moves) * 100 : 0;
    $('insight-title').textContent = reduction > 0 ? `${reduction.toFixed(1)}% fewer moves this run.` : 'Visible runs complete.';
    $('insight-text').textContent = `${LABELS[best.algorithm]} finished in ${number(best.moves)} moves.${hasBaseline ? ` The fixed cycle used ${number(games[0].moves)}.` : ''} One seed is a snapshot; run a batch to compare average performance.`;
  } else {
    $('insight-title').textContent = failed ? 'An incomplete run counts too.' : 'Smaller loops. Checked expansions.';
    $('insight-text').textContent = failed ? 'A solver can fail or reach its move budget before filling the board. Compare completion rates alongside move counts.' : 'Compare eight solvers from the same three-cell start. The hybrid uses local safety checks early, then switches once a compatible cycle is verified. Its early phase has no completion guarantee. Adaptive partial loops retain checked connections to every omitted region.';
  }
  drawChart();
}

function advance() { timeline.advance(); }
function stepBack() {
  if (worker || !timeline.canStepBack) return;
  running = false; finishing = false; accumulator = 0;
  timeline.stepBack();
  update();
}
function togglePlay() {
  if (worker || !settings()) return;
  if (timeline.activeGames.every(g => g.status !== 'running')) reset(true);
  running = !running; finishing = false; accumulator = 0; update();
}
function animate(time) {
  const elapsed = Math.min(100, time - lastTime); lastTime = time;
  if (running) {
    const deadline = performance.now() + 12;
    if (finishing) {
      do { advance(); } while (performance.now() < deadline && timeline.activeGames.some(g => g.status === 'running'));
    } else {
      accumulator += elapsed / 1000 * Number($('speed').value);
      let steps = Math.floor(accumulator);
      accumulator -= steps;
      while (steps-- > 0 && performance.now() < deadline) advance();
    }
    update();
  }
  requestAnimationFrame(animate);
}

function renderBenchmark() {
  const allSummaries = summarize(rows), baseline = allSummaries.find(s => s.algorithm === 'cycle').meanMoves;
  const summaries = allSummaries.filter(s => (batch?.algorithms ?? enabledAlgorithms).includes(s.algorithm));
  $('benchmark-results').innerHTML = summaries.map(s => {
    const delta = baseline && s.meanMoves !== null ? (1 - s.meanMoves / baseline) * 100 : null;
    return `<tr><td><span class="strategy-dot" style="--color:${COLORS[s.algorithm]}"></span>${LABELS[s.algorithm]}</td><td>${s.games ? `${s.wins} / ${s.games}` : '—'}</td><td>${s.meanMoves === null ? '—' : number(s.meanMoves)}</td><td>${s.medianMoves === null ? '—' : number(s.medianMoves)}</td><td>${s.p95Moves === null ? '—' : number(s.p95Moves)}</td><td class="${delta > 0 ? 'positive' : delta < 0 ? 'negative' : ''}">${delta === null ? '—' : s.algorithm === 'cycle' ? 'Reference' : `${Math.abs(delta).toFixed(1)}% ${delta >= 0 ? 'fewer' : 'more'}`}</td><td>${s.meanMs === null ? '—' : `${s.meanMs.toFixed(1)} ms`}</td></tr>`;
  }).join('');
  $('export').disabled = rows.length === 0;
}

function stopBenchmark(message) {
  worker?.terminate(); worker = null;
  $('benchmark').disabled = false;
  $('cancel-benchmark').hidden = true;
  $('benchmark-status').textContent = message;
  if (batch) $('benchmark-note').textContent = `${batch.side} × ${batch.side} board · seeds starting at ${batch.seed} · hybrid target ${Math.round(batch.hybridThreshold * 100)}% · ${rows.length / batch.algorithms.length} of ${batch.count} seeds processed. Move statistics include completed games only. Compute time depends on your device.`;
  update();
}

$('benchmark').addEventListener('click', () => {
  const config = settings();
  if (!config || worker) return;
  running = false; finishing = false; rows = [];
  batch = { side: config.width, seed: config.seed, count: Number($('batch-size').value), hybridThreshold: config.hybridThreshold, algorithms: [...enabledAlgorithms] };
  $('benchmark-progress').hidden = false;
  $('cancel-benchmark').hidden = false;
  $('benchmark').disabled = true;
  $('batch-progress').value = 0;
  $('batch-progress').max = batch.count;
  $('benchmark-status').textContent = `Starting ${batch.count} seeds × ${batch.algorithms.length} solvers…`;
  $('benchmark-note').textContent = `${batch.side} × ${batch.side} board · seeds starting at ${batch.seed} · benchmark in progress.`;
  renderBenchmark();
  try {
    worker = new Worker(new URL('./benchmark-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (data.type === 'working') {
        $('benchmark-status').textContent = `Seed ${data.seed} (${data.index + 1}/${batch.count}) · computing ${LABELS[data.algorithm]}…`;
      } else if (data.type === 'progress') {
        rows.push(...data.rows);
        $('batch-progress').value = data.completed;
        $('benchmark-status').textContent = `${data.completed} / ${batch.count} seeds · ${rows.length} games evaluated`;
        renderBenchmark();
      } else if (data.type === 'done') stopBenchmark(`Complete · ${batch.count * batch.algorithms.length} games evaluated`);
      else if (data.type === 'error') stopBenchmark(`Benchmark stopped: ${data.message}`);
    };
    worker.onerror = () => stopBenchmark('The benchmark worker could not run. Serve this app over HTTP and try again.');
    worker.postMessage(batch);
  } catch (error) { stopBenchmark(`Benchmark unavailable: ${error.message}`); }
  update();
});
$('cancel-benchmark').addEventListener('click', () => stopBenchmark('Cancelled · partial results retained'));
$('export').addEventListener('click', () => {
  const keys = ['algorithm', 'width', 'height', 'seed', 'status', 'moves', 'shortcuts', 'repairs', 'elapsedMs', 'hybridThreshold', 'hybridSwitchLength', 'hybridSwitchActualLength', 'hybridSwitchMove', 'earlyMoves', 'hybridRecoveryMoves', 'greedyReplans', 'certifiedReplans', 'partialRoutes', 'partialReplans', 'partialSplits', 'partialMerges', 'partialRecoveryMoves'];
  const csv = [keys.join(','), ...rows.map(row => keys.map(key => row[key]).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `snake-lab-${batch.side}x${batch.side}-seed-${batch.seed}.csv`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('play').addEventListener('click', togglePlay);
$('reset').addEventListener('click', () => reset(true));
$('step').addEventListener('click', () => { if (settings()) { advance(); update(); } });
$('step-back').addEventListener('click', stepBack);
$('finish').addEventListener('click', () => { if (settings()) { running = true; finishing = true; update(); } });
$('board').addEventListener('change', () => {
  const custom = $('board').value === 'custom';
  $('custom-size-label').hidden = !custom;
  $('custom-size-help').hidden = !custom;
  if (custom) $('custom-size').value = games[0].width;
  reset();
});
$('custom-size').addEventListener('input', () => {
  $('custom-size').setCustomValidity('');
  running = false; finishing = false; accumulator = 0; update();
});
$('custom-size').addEventListener('change', () => reset());
$('custom-size').addEventListener('keydown', event => {
  if (event.key === 'Enter') { event.preventDefault(); reset(); }
});
$('hybrid-threshold').addEventListener('change', () => reset());
$('seed').addEventListener('input', () => $('seed').setCustomValidity(''));
$('seed').addEventListener('change', () => reset());
$('new-seed').addEventListener('click', () => { $('seed').value = crypto.getRandomValues(new Uint32Array(1))[0]; $('seed').setCustomValidity(''); reset(); });
$('show-cycle').addEventListener('change', update);
$('later-only').addEventListener('click', () => { laterOnly = !laterOnly; changeView(); });
$('exit-focus').addEventListener('click', () => changeView());
$('boards').addEventListener('click', event => {
  const card = event.target.closest('.board-card');
  if (!card) return;
  if (focusedAlgorithm !== card.dataset.algorithm) changeView(card.dataset.algorithm);
  else if (event.target.closest('.expand-board')) changeView();
});
document.addEventListener('keydown', event => {
  if (event.code === 'Escape' && focusedAlgorithm) { event.preventDefault(); changeView(); return; }
  if (/INPUT|SELECT|TEXTAREA|SUMMARY/.test(event.target.tagName) || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.code === 'ArrowLeft' && !worker) { event.preventDefault(); stepBack(); }
  if (event.code === 'ArrowRight' && !running && !worker) { event.preventDefault(); if (settings()) { advance(); update(); } }
  if (event.target.tagName === 'BUTTON') return;
  if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
  if (event.code === 'KeyR') reset(true);
});
reset(); renderBenchmark(); requestAnimationFrame(animate);
