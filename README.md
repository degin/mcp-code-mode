# mcp-code-mode

Measure, then cut, what an MCP server costs you in context — by calling its tools from a script instead of making the model read every intermediate result.

No SDK, no framework: one 180-line client over Streamable HTTP, five benchmark scripts, and the numbers they produced on a live server.

```
whole tools/list a client receives   23 350 tokens
one and the same task, classic route  4 315 tokens  7 model turns
one and the same task, one script       277 tokens  1 model turn
```

## Why

A connected MCP server is paid for three times, and all three are easy to miss.

1. **Schemas.** The client keeps every tool definition in context. 44 tools — 23 350 tokens on every turn, of which one or two are actually used.
2. **Intermediate results.** The model has to read each raw tool response to choose the next call. A seven-call task grows the transcript from 3.5k to 9k tokens, and every following turn pays for all of it again.
3. **Turns.** Each call is a separate model turn, and a turn costs more than the call.

Level 1 (deferred tools / progressive disclosure) removes the first cost. Level 2 removes the second and the third.

| Level | What it is | Removes |
|---|---|---|
| 1. deferred tools | client shows names + one-line descriptions, sends the full schema only for the chosen tool | schema cost |
| 2. script runner | the model writes a short script; the script calls tools, filters and aggregates locally, only the result returns | intermediate results, extra turns |
| 3. server-side code mode | `search()` + `execute()` inside a sandbox on the server | all three, worth it at hundreds of tools |

This repo is level 2, measured on a server with 44 tools. Level 3 is overkill there.

## Quick start

```bash
npm i
cp config/example.env .env      # fill MCP_URL and the token

node client.mjs $MCP_URL list                      # tool count + schema cost
node client.mjs $MCP_URL call get_task_data '{"id":"..."}'
```

`client.mjs` is standalone: `initialize`, then `tools/call` with the `Mcp-Session-Id` header the server returned. Both response shapes are handled (`application/json` and `text/event-stream`) because the server picks one. The token comes from `MCP_TOKEN` (rename via `MCP_TOKEN_VAR`) in env or `.env`, and is never printed.

## Benchmarks

Run them against your own server. `01`, `03`, `04` are generic; `02` is an example scenario you edit; `05` is offline arithmetic.

| Script | What it measures |
|---|---|
| `bench/01-schema-cost.mjs` | the whole `tools/list` vs descriptions vs schemas vs compressed signatures vs one schema |
| `bench/02-task-paths.mjs` | one task through three routes: naive classic, careful classic, one script |
| `bench/03-latency.mjs` | `initialize`, calls in a live session, cold CLI process |
| `bench/04-fanout.mjs` | N calls sequential vs parallel in one process |
| `bench/05-billing.mjs` | what the session actually costs once context is re-sent every turn (offline) |

## Numbers from the live run

Server: 44 tools. Tokens counted with `gpt-tokenizer` (`o200k_base`) on real responses.

| What | Tokens |
|---|---|
| whole `tools/list` | 23 350 |
| descriptions only | 14 476 |
| `inputSchema` only | 7 922 |
| compressed signatures | 1 084 |
| one schema | 66 |

One task — open cards of a board with id, title, column and deadline:

| Route | Tokens read by the model | Turns | HTTP |
|---|---|---|---|
| naive: project tree + raw board payload | 6 633 | 2 | 366 ms |
| careful: field projection + cards one by one | 4 315 | 7 | 677 ms |
| one script | 277 | 1 | 218 ms |

Billing for the same task (context re-sent every turn; assumptions: base 3 500, output 150, final answer 120):

| Scenario | Tokens paid |
|---|---|
| classic, schemas on demand | 39 178 |
| classic, all schemas in the prompt | 202 628 |
| code mode | 3 770 |

Latency: `initialize` 251 ms, a call in an open session 124 ms, a fresh script process for one call 580 ms, `mcporter` called directly 1 200 ms, `npx mcporter` 2 480 ms. Nine cards: 1 059 ms sequential, 210 ms parallel in one script.

The speed win is not the network. It is the number of model turns: one script is one turn.

## When it is worth it

- Three or more calls to the same server in one task.
- Any single response above ~2 000 tokens.
- A loop over a collection: board cards, project pages, database records.

A single read of one field is cheaper done directly — a cold process costs 0.5–0.6 s, more than you save on one result.

## Pitfalls

- **Sandbox the script.** It runs with your user rights and your tokens; never let it write to production without an explicit decision.
- **Never print the token.** Read it from env or `.env`, keep it out of logs and out of the code.
- **Counting tokens without a real tokenizer lies.** `chars / 4` is off by ~1.5x on Cyrillic; `chars / 3.5` is still approximate. Use a tokenizer.
- **A generated TypeScript client is a reference, not context.** `mcporter emit-ts` on 44 tools produces 22 836 tokens worth of code; reading it costs more than keeping the schemas. Its value is editor autocomplete plus one JSDoc block (~400 tokens) in context.
- **Wrap repeated operations.** A ready script costs the model ~50 tokens to invoke, against regenerating it every time.
- **Do not launch through `npx`** in a hot path: 2.5 s against 1.2 s for the same CLI called through `node`, against 0.58 s for a plain script.

## По-русски

Тот же материал кратко: подключённый MCP-сервер стоит дорого трижды — схемы тулов в каждом ходе, сырые ответы тулов в контексте, отдельный ход модели на каждый вызов. Скрипт снимает вторую и третью потерю: одна и та же задача обходится в 350 токенов и один ход вместо 4 315 токенов и семи ходов, оплаченный объём сессии падает с 39 178 до 3 770 токенов. Скрипт `client.mjs` ходит в MCP напрямую по Streamable HTTP и не требует SDK. Замеры — выше, воспроизведение — в `bench/`.

## License

MIT.
