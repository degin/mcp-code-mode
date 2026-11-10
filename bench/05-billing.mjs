// 05: an offline billing model. No server needed — plug your own numbers.
// A classic agent re-sends the whole conversation on every turn, so every intermediate
// tool result is paid for again on each following turn. That is the real bill.
//
//   BASE = base context per turn (system prompt + history before the task)
//   OUT  = model output per turn, ANS = final answer
import { big } from '../client.mjs';

const num = (name, def) => Number(process.env[name] ?? def);
const BASE = num('BASE', 3500);
const OUT = num('OUT', 150);
const ANS = num('ANS', 120);
const SCHEMAS = num('SCHEMAS', 23350); // whole tools/list, see 01

// What lands in the transcript, per turn, for the same task ("open cards of a board"):
const classic = [204, 703, 1199, 878, 446, 447, 438]; // tree, projection, five cards
const codeMode = [350];                              // one script: source + compact result

// Cost of a conversation that re-sends its whole transcript every turn.
function bill(results, extra = 0) {
  let sum = 0;
  let seen = 0;
  results.forEach((r, i) => {
    sum += BASE + extra + seen + OUT + (i === results.length - 1 ? ANS : 0);
    seen += r;
  });
  return sum;
}

const deferred = bill(classic);
const allSchemas = bill(classic, SCHEMAS);
const code = bill(codeMode);

console.log(`assumptions: BASE ${BASE}, OUT ${OUT}, ANS ${ANS}, tools/list ${SCHEMAS}`);
console.log(`classic, schemas on demand:  ${big(deferred)} tokens`);
console.log(`classic, all schemas:        ${big(allSchemas)} tokens`);
console.log(`code mode:                   ${big(code)} tokens`);
console.log(`savings: ${Math.round((1 - code / deferred) * 100)}% and ${Math.round((1 - code / allSchemas) * 100)}%`);
