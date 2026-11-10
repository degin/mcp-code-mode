// Minimal MCP client over Streamable HTTP: no SDK, no dependencies.
// Handles both response shapes a server may pick: application/json and text/event-stream.
//
//   node client.mjs <url> list                → tool count + context cost of the schemas
//   node client.mjs <url> call <tool> '{"a":1}'
//
// URL: first argument or MCP_URL.
// Token: variable name in MCP_TOKEN_VAR (default MCP_TOKEN), value from env or ./.env.
// The token is never printed.
import fs from 'node:fs';
import path from 'node:path';

export const env = (name) => {
  if (process.env[name]) return process.env[name];
  for (const p of ['.env', path.join(process.cwd(), '.env')]) {
    try {
      const line = fs.readFileSync(p, 'utf8').split(/\r?\n/).find((l) => l.startsWith(name + '='));
      if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
    } catch {}
  }
  return undefined;
};

export const MCP_TOKEN_VAR = process.env.MCP_TOKEN_VAR || 'MCP_TOKEN';

// Real tokenizer when available: on Russian text a chars/4 guess is off by ~1.5x.
let enc = null;
try {
  enc = (await import('gpt-tokenizer')).encode;
} catch {
  console.error('[countTokens] gpt-tokenizer not installed (npm i gpt-tokenizer); falling back to chars/3.5, which lies on Cyrillic.');
}
export async function countTokens(text) {
  const s = typeof text === 'string' ? text : JSON.stringify(text);
  if (!enc) return Math.ceil(s.length / 3.5);
  return enc(s).length;
}
export const big = (n) => n.toLocaleString('en-US').replace(',', ' ');

function parse(raw, ctype) {
  if ((ctype || '').includes('text/event-stream')) {
    const out = [];
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      const obj = JSON.parse(data);
      out.push(obj.message ?? obj);
    }
    return out;
  }
  return [JSON.parse(raw)];
}

export class Session {
  constructor(url = process.env.MCP_URL) {
    if (!url) throw new Error('MCP url required: first argument or MCP_URL');
    this.url = url;
    this.sid = null;
    this.id = 0;
    this.httpMs = 0;
    this.calls = 0;
  }

  async rpc(method, params) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
    };
    const token = env(MCP_TOKEN_VAR);
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.sid) headers['mcp-session-id'] = this.sid;

    const t0 = performance.now();
    const r = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
    });
    this.httpMs += performance.now() - t0;
    this.calls++;

    const sid = r.headers.get('mcp-session-id');
    if (sid) this.sid = sid;
    const raw = await r.text();
    if (!r.ok) throw new Error(`${r.status} ${raw.slice(0, 300)}`);
    const msgs = parse(raw, r.headers.get('content-type'));
    const err = msgs.find((m) => m.error);
    if (err) throw new Error(JSON.stringify(err.error).slice(0, 300));
    return msgs.at(-1)?.result;
  }

  // JSON-RPC notification: no id, no response to parse.
  async notify(method, params) {
    const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
    const token = env(MCP_TOKEN_VAR);
    if (token) headers.authorization = `Bearer ${token}`;
    if (this.sid) headers['mcp-session-id'] = this.sid;
    try {
      await fetch(this.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method, params }) });
    } catch {
      // a notification has no failure mode we can act on
    }
  }

  async init() {
    const r = await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'mcp-code-mode', version: '1.0.0' },
    });
    await this.notify('notifications/initialized', {});
    this.info = r?.serverInfo;
    return this;
  }

  async tools() {
    const r = await this.rpc('tools/list', {});
    return r?.tools ?? [];
  }

  async call(name, args = {}) {
    const r = await this.rpc('tools/call', { name, arguments: args });
    const text = (r?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    return text || JSON.stringify(r?.structuredContent ?? r);
  }
}

export function signatures(tools) {
  return tools.map((t) => `function ${t.name}(${argsSig(t.inputSchema)});`).join('\n');
}

function argsSig(schema) {
  const props = schema?.properties ?? {};
  const req = new Set(schema?.required ?? []);
  return Object.entries(props).map(([k, v]) => {
    let type = v.type ?? 'unknown';
    if (v.enum) type = v.enum.map((x) => `"${x}"`).join('|');
    else if (v.type === 'array') {
      type = (v.items?.enum ? `(${v.items.enum.map((x) => `"${x}"`).join('|')})` : v.items?.type ?? 'unknown') + '[]';
    }
    return `${k}${req.has(k) ? '' : '?'}: ${type}`;
  }).join(', ');
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('client.mjs')) {
  const args = process.argv.slice(2);
  let url = process.env.MCP_URL;
  if (args[0]?.startsWith('http')) url = args.shift();
  const [cmd, tool, raw] = args;
  if (!url) {
    console.error('usage: node client.mjs <url> list|call <tool> [json]   (or set MCP_URL)');
    process.exit(1);
  }
  const s = await new Session(url).init();
  if (cmd === 'list') {
    const tools = await s.tools();
    console.log(`server: ${url}`);
    console.log(`tools: ${tools.length}`);
    console.log(`tools/list as sent to a client: ${big(await countTokens(tools))} tokens`);
    const brief = signatures(tools);
    console.log(`compressed signatures:          ${big(await countTokens(brief))} tokens`);
    console.log(brief);
  } else if (cmd === 'call') {
    if (!tool) {
      console.error("usage: node client.mjs <url> call <tool> '{\"arg\":1}'");
      process.exit(1);
    }
    const out = await s.call(tool, JSON.parse(raw ?? '{}'));
    console.log(out);
    console.error(`[${s.calls} rpc, ${Math.round(s.httpMs)} ms, ${await countTokens(out)} tokens]`);
  } else {
    console.error('usage: node client.mjs <url> list|call <tool> [json]');
    process.exit(1);
  }
}
