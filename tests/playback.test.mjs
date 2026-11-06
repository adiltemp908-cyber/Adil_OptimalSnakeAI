import test from 'node:test';
import assert from 'node:assert/strict';
import { SnakeGame, ALGORITHMS } from '../dist/engine.js';
import { PlaybackTimeline, PlaybackGroup } from '../dist/playback.js';

const makeGames = () => ALGORITHMS.map(algorithm => new SnakeGame({width:8,height:8,seed:42,algorithm}));
const snapshot = timeline => structuredClone(timeline.games);

test('every tick can be reversed and replayed exactly, including growth, repairs, plans, and completion', () => {
  const timeline = new PlaybackTimeline(makeGames()), states = [snapshot(timeline)];
  let sawPlan = false, sawPartialFinish = false;
  assert.equal(timeline.stepBack(),false);
  while (timeline.advance()) {
    states.push(snapshot(timeline));
    sawPlan ||= timeline.games.some(g=>g.activePlan);
    sawPartialFinish ||= timeline.games.some(g=>g.status==='won') && timeline.games.some(g=>g.status==='running');
  }
  assert.ok(sawPlan); assert.ok(sawPartialFinish);
  assert.ok(timeline.games.every(g=>g.status==='won'));
  for(let i=states.length-2;i>=0;i--) {
    assert.equal(timeline.stepBack(),true);
    assert.deepEqual(timeline.games,states[i]);
  }
  assert.equal(timeline.canStepBack,false);
  // Replaying recorded moves must not call the live solvers again.
  timeline.liveGames.forEach(g=>{g.step=()=>{throw new Error('Recomputed a recorded tick');};});
  for(let i=1;i<states.length;i++) {
    assert.equal(timeline.advance(),true);
    assert.deepEqual(timeline.games,states[i]);
  }
  assert.equal(timeline.advance(),false);
});

test('resuming beyond a rewound frontier preserves all future solver and food decisions', () => {
  const live = makeGames(), reference = makeGames(), timeline = new PlaybackTimeline(live);
  for(let i=0;i<100;i++) timeline.advance();
  for(let i=0;i<75;i++) timeline.stepBack();
  for(let i=0;i<125;i++) timeline.advance();
  for(let i=0;i<150;i++) reference.forEach(game=>game.step());
  assert.equal(timeline.cursor,150);
  assert.deepEqual(timeline.games,new PlaybackTimeline(reference).games);
  live.forEach(game=>game.assertInvariants());
});

test('a new comparison starts with an empty rewind history', () => {
  const previous = new PlaybackTimeline(makeGames()); previous.advance();
  const reset = new PlaybackTimeline(makeGames());
  assert.equal(reset.canStepBack,false); assert.equal(reset.cursor,0);
  assert.ok(reset.games.every(game=>game.moves===0));
});

test('focused and later-six playback leave hidden histories and random state untouched', () => {
  const group = new PlaybackGroup(makeGames());
  for (let i = 0; i < 3; i++) group.advance();
  const hidden = structuredClone(group.games.slice(0, 5));
  group.select(['hybrid']);
  for (let i = 0; i < 5; i++) group.advance();
  assert.deepEqual(group.games.slice(0, 5), hidden);
  group.stepBack(); group.stepBack();
  assert.equal(group.activeGames[0].moves, 6);
  const hybrid = group.timelines.get('hybrid');
  hybrid.liveGames[0].step = () => { throw new Error('Recomputed a saved focused step'); };
  group.select(ALGORITHMS.slice(3));
  group.advance(); group.advance();
  assert.deepEqual(group.games.slice(0, 3), hidden.slice(0, 3));
  assert.deepEqual(group.games.map(game => game.moves), [3, 3, 3, 5, 5, 8, 5, 5, 5]);
  group.select(ALGORITHMS);
  assert.deepEqual(group.games.map(game => game.moves), [3, 3, 3, 5, 5, 8, 5, 5, 5]);
  assert.throws(() => group.select([]));
  assert.throws(() => group.select(['hybrid', 'hybrid']));
});

test('restarting a focused solver clears only its own history', () => {
  const group = new PlaybackGroup(makeGames());
  for (let i = 0; i < 10; i++) group.advance();
  const others = structuredClone(group.games.slice(0, 5));
  group.select(['hybrid']);
  group.replace(new SnakeGame({ width: 8, height: 8, seed: 42, algorithm: 'hybrid' }));
  assert.equal(group.activeGames[0].moves, 0);
  assert.equal(group.canStepBack, false);
  assert.deepEqual(group.games.slice(0, 5), others);
  group.select(['certified']);
  assert.equal(group.canStepBack, true);
  group.stepBack();
  assert.equal(group.activeGames[0].moves, 9);
});

test('a focused solver finishes and rewinds without advancing any other solver', () => {
  const group = new PlaybackGroup(makeGames());
  group.select(['hybrid']);
  while (group.advance()) {}
  assert.equal(group.activeGames[0].status, 'won');
  assert.ok(group.games.slice(0, 5).every(game => game.moves === 0));
  const completed = structuredClone(group.activeGames[0]);
  group.stepBack();
  assert.equal(group.activeGames[0].status, 'running');
  assert.equal(group.activeGames[0].moves, completed.moves - 1);
  group.advance();
  assert.deepEqual(group.activeGames[0], completed);
});
