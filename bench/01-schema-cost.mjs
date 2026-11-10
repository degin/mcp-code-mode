// 01: what it costs to "keep MCP in context".
// Measures: the whole tools/list a client receives, only descriptions, only schemas,
// a compressed signature list, and the single largest schema (the deferred-tool path).
import fs from 'node:fs';
import { Session, countTokens, big, signatures } from '../client.mjs';

const s = await new Session().init();
const tools = await s.tools();
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/tools.json', JSON.stringify(tools, null, 1));

const brief = signatures(tools);
const sizes = await Promise.all(tools.map(async (t) => ({ name: t.name, tokens: await countTokens(t.inputSchema) })));
const largest = sizes.sort((a, b) => b.tokens - a.tokens)[0];

const rows = {
  'tools on the server': tools.length,
  'whole tools/list (JSON)': await countTokens(tools),
  'descriptions only': await countTokens(tools.map((t) => t.description ?? '')),
  'inputSchema only': await countTokens(tools.map((t) => t.inputSchema)),
  'compressed signatures': await countTokens(brief),
  [`largest single schema (${largest?.name})`]: largest?.tokens ?? 0,
};
for (const [k, v] of Object.entries(rows)) {
  console.log(`${k.padEnd(38)} ${typeof v === 'number' && k.includes('schema') ? big(v) + ' tokens' : v}`);
}
console.log('\nfirst 700 chars of the compressed list:\n' + brief.slice(0, 700));
