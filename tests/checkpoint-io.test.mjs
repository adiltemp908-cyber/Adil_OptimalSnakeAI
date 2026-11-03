import test from 'node:test';
import assert from 'node:assert/strict';
import { writeSnapshot } from '../scripts/checkpoint-io.mjs';

test('Windows replacement lock preserves the last checkpoint and allows the next update', () => {
  const files = new Map([['checkpoint', 'old']]);
  let locked = true, warnings = 0;
  const io = {
    writeFileSync: (file, data) => files.set(file, data),
    renameSync: (from, to) => {
      if (locked) throw Object.assign(new Error('Locked'), { code: 'EPERM' });
      files.set(to, files.get(from)); files.delete(from);
    },
  };
  assert.equal(writeSnapshot('checkpoint', 'new', io, () => warnings++), false);
  assert.equal(files.get('checkpoint'), 'old');
  assert.equal(files.get('checkpoint.tmp'), 'new');
  assert.equal(warnings, 1);
  locked = false;
  assert.equal(writeSnapshot('checkpoint', 'newest', io), true);
  assert.equal(files.get('checkpoint'), 'newest');
  assert.equal(files.has('checkpoint.tmp'), false);
});

test('disk-full errors remain visible instead of pretending a checkpoint succeeded', () => {
  const error = Object.assign(new Error('Disk full'), { code: 'ENOSPC' });
  assert.throws(() => writeSnapshot('full', 'data', { writeFileSync() { throw error; } }), error);
});
