// 04: loops and parallelism inside one script — the part a classic agent has to pay
// a separate turn for, every iteration.
// Compares N sequential calls against the same N in parallel within one process.
import { Session } from '../client.mjs';

const TOOL = process.env.FAN_TOOL;
const ARGS = process.env.FAN_ARGS; // JSON array of argument objects
if (!TOOL || !ARGS) {
  console.error('set FAN_TOOL and FAN_ARGS (JSON array of args); see config/example.env');
  process.exit(1);
}
const list = JSON.parse(ARGS);
const s = await new Session().init();
const ms = (t) => Math.round(performance.now() - t);

let t0 = performance.now();
for (const a of list) await s.call(TOOL, a);
const seq = ms(t0);

t0 = performance.now();
await Promise.all(list.map((a) => s.call(TOOL, a)));
const par = ms(t0);

console.log(`sequential ${list.length} calls: ${seq} ms (${Math.round(seq / list.length)} ms each)`);
console.log(`parallel   ${list.length} calls: ${par} ms`);
console.log(`gain: ${Math.round((1 - par / seq) * 100)}% of the wall time, and 1 model turn instead of ${list.length}`);
