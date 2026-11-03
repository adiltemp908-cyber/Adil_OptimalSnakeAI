import { writeFileSync, renameSync } from 'node:fs';

const transient = new Set(['EPERM', 'EACCES', 'EBUSY']);
const warned = new Set();
const pause = new Int32Array(new SharedArrayBuffer(4));

// Windows readers/indexers can temporarily prevent replacing an open file.
// Keep the complete temporary snapshot and retry on the next save rather than
// allowing a display/checkpoint update to terminate all benchmark workers.
export function writeSnapshot(file, content, io = { writeFileSync, renameSync }, warn = console.warn) {
  try {
    io.writeFileSync(`${file}.tmp`, content);
    for (let attempt = 0; ; attempt++) {
      try { io.renameSync(`${file}.tmp`, file); break; }
      catch (error) {
        if (!transient.has(error.code) || attempt === 3) throw error;
        Atomics.wait(pause, 0, 0, 25 * (attempt + 1));
      }
    }
    warned.delete(file);
    return true;
  } catch (error) {
    if (!transient.has(error.code)) throw error;
    if (!warned.has(file)) warn(`Snapshot temporarily locked: ${file} (${error.code}); will retry on the next update.`);
    warned.add(file);
    return false;
  }
}
