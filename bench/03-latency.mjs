// 03: latency. What each access path costs per call.
//   a) initialize + N calls inside one live session
//   b) the same through a CLI in a cold process (npx mcporter), if mcporter is installed
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Session } from '../client.mjs';

const run = promisify(execFile);
const ms = (t) => Math.round(performance.now() - t);
const avg = (a) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);

const TOOL = process.env.ONE_TOOL;
const ARGS = process.env.ONE_ARGS || '{}';
const N = Number(process.env.N || 5);
if (!TOOL) {
  console.error('set ONE_TOOL (and optionally ONE_ARGS as JSON); see config/example.env');
  process.exit(1);
}

let t0 = performance.now();
const s = await new Session().init();
console.log(`a) initialize:                 ${ms(t0)} ms`);
const times = [];
for (let i = 0; i < N; i++) {
  t0 = performance.now();
  await s.call(TOOL, JSON.parse(ARGS));
  times.push(ms(t0));
}
console.log(`   call in a live session (${N}):    avg ${avg(times)} ms, min ${Math.min(...times)}, max ${Math.max(...times)}`);

const mcporter = process.env.MCPORTER_CONFIG;
if (!mcporter) {
  console.log('b) CLI comparison skipped: set MCPORTER_CONFIG to an mcporter config path');
  process.exit(0);
}
const cold = [];
for (let i = 0; i < 3; i++) {
  t0 = performance.now();
  try {
    await run('npx', ['--no-install', 'mcporter', 'call', `${process.env.MCPORTER_SERVER}.${TOOL}`, '--config', mcporter], { shell: true });
    cold.push(ms(t0));
  } catch (e) {
    console.log('   mcporter failed: ' + String(e.message).slice(0, 160));
    break;
  }
}
if (cold.length) console.log(`b) cold npx mcporter call:      avg ${avg(cold)} ms (${cold.join(', ')})`);
