// 02: one and the same task through three routes. Counts what the model has to read
// and how many round-trips (each one is a separate generation turn) it takes.
//
// Scenario (example server: YouGile MCP): open cards of one board with id, title,
// column name and deadline. Point it at your own server by editing the calls below.
import { Session, countTokens, big } from '../client.mjs';

const PROJECT = process.env.PROJECT_ID;
const BOARD = process.env.BOARD_ID;
if (!PROJECT || !BOARD) {
  console.error('set PROJECT_ID and BOARD_ID (env or .env); see config/example.env');
  process.exit(1);
}

const s = await new Session().init();
const now = () => performance.now();

// ---------- A: naive route — take whatever the tools return ----------
let t0 = now();
const tree = await s.call('get_project_tree', { id: PROJECT, cursor: '', projectState: 'active' });
const rawAll = await s.call('query_tasks', { jsCode: `return tasks.filter(t => t.boardId === '${BOARD}' && !t.archived)`, cursor: '' });
const A = { tokens: await countTokens(tree) + await countTokens(rawAll), turns: 2, ms: now() - t0 };

// ---------- B: careful classic route — project fields, then fetch cards one by one ----------
t0 = now();
const proj = await s.call('query_tasks', {
  jsCode: `return tasks.filter(t => t.boardId === '${BOARD}' && !t.archived && !t.complete)`
    + `.map(t => ({id: t.id, taskId: t.taskId, title: t.title, columnId: t.columnId, deadline: t.deadline}))`,
  cursor: '',
});
const items = JSON.parse(proj).items;
const cards = [];
for (const it of items.slice(0, 5)) cards.push(await s.call('get_task_data', { id: it.id, cursor: '' }));
const B = {
  tokens: await countTokens(tree) + await countTokens(proj)
    + (await Promise.all(cards.map((c) => countTokens(c)))).reduce((n, x) => n + x, 0),
  turns: 2 + cards.length,
  ms: now() - t0,
};

// ---------- C: one script — the model writes it once, the process does the loop ----------
t0 = now();
const tree2 = await s.call('get_project_tree', { id: PROJECT, cursor: '', projectState: 'active' });
const colName = {};
for (const p of JSON.parse(tree2).projects) for (const b of p.boards) for (const c of b.columns) colName[c.id] = c.title;

let cursor = '';
const open = [];
do {
  const page = JSON.parse(await s.call('query_tasks', {
    jsCode: `return tasks.filter(t => t.boardId === '${BOARD}' && !t.archived && !t.complete)`
      + `.map(t => ({id: t.id, taskId: t.taskId, title: t.title, columnId: t.columnId, deadline: t.deadline}))`,
    cursor,
  }));
  open.push(...page.items);
  cursor = page.nextCursor ?? '';
} while (cursor);

const byCol = {};
for (const task of open) (byCol[colName[task.columnId] ?? task.columnId] ??= []).push(task);
const lines = [`open cards on board: ${open.length}`];
for (const [col, list] of Object.entries(byCol)) {
  lines.push(`${col} (${list.length}):`);
  for (const t of list) lines.push(`  ${t.taskId || '-'} ${t.title}${t.deadline ? ' | due ' + t.deadline.slice(0, 10) : ''}`);
}
const output = lines.join('\n');
const source = `const tree = mcp.get_project_tree({id:"${PROJECT}",cursor:"",projectState:"active"});\n`
  + `let cursor=""; const open=[];\ndo { const p = mcp.query_tasks({jsCode:"...project 5 fields...", cursor});\n`
  + `     open.push(...p.items); cursor = p.nextCursor ?? ""; } while (cursor);\n`
  + `// group by column, print compactly`;
const C = { tokens: await countTokens(source) + await countTokens(output), turns: 1, ms: now() - t0 };

const fmt = (o) => `${big(o.tokens)} tokens | ${o.turns} turn(s) | ${Math.round(o.ms)} ms`;
console.log('A naive classic (raw board JSON):        ' + fmt(A));
console.log('B careful classic (projection + 5 cards): ' + fmt(B));
console.log('C one script (code mode):                 ' + fmt(C));
console.log(`\nC vs A: ${Math.round((1 - C.tokens / A.tokens) * 100)}% fewer tokens, ${A.turns - C.turns} fewer turns`);
console.log(`C vs B: ${Math.round((1 - C.tokens / B.tokens) * 100)}% fewer tokens, ${B.turns - C.turns} fewer turns`);
console.log('\n--- what the model actually saw in C ---\n' + output);
