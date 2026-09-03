# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Backend (repo root, Node >= 22):

```bash
docker compose up postgres -d   # required for almost everything below
npm run dev              # mastra dev — hot reload, http://localhost:4111
npm run build            # mastra build --studio  (output: .mastra/output/index.mjs)
npm run typecheck        # tsc --noEmit
npm test                 # vitest run (needs TEST_DATABASE_URL, else skipped)
npm run db:generate      # drizzle-kit generate — after editing src/db/schema.ts
npm run db:deploy        # drizzle migrations + storage.init(); same cmd Railway runs
npm run db:prune         # apply retention policies via storage.prune()
npm run teams:manifest   # TEAMS_APP_ID=<guid> node teams-app/build.mjs -> teams-app/dist/teams-app.zip
```

`DATABASE_URL=postgres://mastra:mastra@localhost:5432/mastra` for all of these locally.

Frontend (`frontend/`, separate npm project):

```bash
npm run dev              # next dev --turbopack, http://localhost:3000
npm run lint             # oxlint && oxfmt --check
npm run lint:fix
```

Docker (both services): `docker compose up --build`. The image is a production build,
so there is no hot reload inside the container — run `npm run dev` on the host instead.
Frontend-only dev against a containerized backend: `docker compose up mastra`, then
`cd frontend && cp .env.example .env.local && npm run dev`.

Before pushing: `npm run typecheck && npm run build`.

`tests/suspend-resume.test.ts` is the only backend test; it needs a real Postgres and
`describe.skip`s itself without `TEST_DATABASE_URL`. There is no backend lint config —
`typecheck` + `build` are the gate.

## Architecture

A receipt-capture app: images in, structured JSON out. Two front doors (a Next.js
assistant-ui chat and a Microsoft Teams bot) both funnel into **one** extraction path.

```
Browser ─► frontend/app/api/* ─► POST /chat/receiptChatAgent
                                    └─ tool extract-receipt ─────► receipt-extraction-workflow
                                                                     load → extract → write-json
                                                                            ▲
Teams ─► POST /api/agents/teams-agent/channels/teams/webhook                │ (nested)
           └─ handleTeamsReceipt ─► receipt-review-workflow ────────────────┘
                                      └─ review-candidate ─► suspend ─► Vorlage im Thread
                                            ▲                              │
                                            └──── run.resume() ◄───────────┘
                                      └─ persist-receipt ─► app.receipts
```

Three invariants to preserve:

1. **Extraction lives only in `receipt-extraction-workflow`.** The review workflow nests it;
   the web tool calls it directly. It never suspends — the frontend has no way to answer.
2. **Image bytes never travel through chat context.** Every entry point stores the file via
   `receipts/upload-store.ts`, gets an `uploadId`, and passes only file *paths* onward.
3. **Nothing is written to the DB before the user confirms.** No write-then-clean-up.

Key pieces (`src/mastra/`):

- `index.ts` — the `Mastra` instance: agent registry, workflow, `chatRoute()`, receipt routes, CORS, body size limit.
- `workflows/receipt-extraction-workflow.ts` — three steps: read file → data URL, call `receipt-extraction-agent` with `structuredOutput`, write `<RECEIPT_DATA_DIR>/receipts/<id>.json`.
- `workflows/receipt-review-workflow.ts` — the human-in-the-loop path. `review-candidate` is one step that calls `suspend()` repeatedly: no `resumeData` → present; `confirm` → proceed; `correct` → apply free-text via `receipt-correction-agent`, then present *again*. Candidate + round counter live in workflow state (`setState`), so they land in `mastra_workflow_snapshot` and survive a deploy.
- `receipts/candidate.ts` — the only place the extraction output is *interpreted*: markers → null, `"CHF 42.10"` → amount + ISO currency, dates → `YYYY-MM-DD`, plus the deterministic `computeConfidence()`.
- `db/` — `pool.ts` (the single `pg.Pool`), `schema.ts` (Drizzle, all inside `pgSchema('app')`), `receipts.ts` (repository; **every** function takes `userId` first and puts it in every `WHERE`).
- `agents/receipt-agent.ts` — vision agent + `receiptSchema` (the source of truth for the receipt shape; every field is a string, with `NOT_PRESENT` / `ILLEGIBLE` markers instead of blanks).
- `agents/receipt-chat-agent.ts` + `tools/extract-receipt-tool.ts` — the web chat path; the tool resolves `uploadId`s to paths and runs the workflow sequentially.
- `agents/teams-agent.ts` + `channels/teams-receipt-handler.ts` — the Teams path. Message *with* image → start a review run. Message *without* → if `app.pending_reviews` has a row for this thread, it's the answer to a pending presentation (`classifyReply` → `run.resume()`); otherwise `defaultHandler` (the model, with the DB tools).
- `tools/receipt-db-tools.ts` + `tools/tool-context.ts` — four narrow tools, no generic SQL.
- `receipts/upload-store.ts` — allowed types (JPG/PNG/WebP/GIF only), `MAX_UPLOAD_BYTES` (15 MB), and `UPLOAD_ID_PATTERN`. The strict `<uuid><ext>` pattern *is* the path-traversal defense — don't loosen it.
- `storage.ts` / `model.ts` — single points for `PostgresStore` (schema `mastra`, `disableInit: true`) and the `MASTRA_MODEL` choice.

### Routing and API gotchas

- **Chat route `:agentId` is the registry key** in `index.ts` (`receiptChatAgent`), not the agent's `id`.
- **Teams webhook path uses the agent's `id`** (`teams-agent`), not the key (`teamsAgent`). Changing that `id` changes the Azure messaging endpoint.
- Custom routes deliberately avoid the `/api` prefix — Mastra reserves it.
- **`/health` is taken by Mastra** and silently wins over a custom route of the same name (it returns `{"success":true}` with no DB check). Ours is `/healthz`.
- **In Mastra v1 the mechanism is `RequestContext`**, from `@mastra/core/request-context` — not `runtimeContext`.
- A workflow with a `stateSchema` **requires `initialState` at `run.start()`**, else it throws `Invalid initial data`. Hence `initialReviewState`.
- `drizzle-kit`'s migration journal lives in its own `drizzle` schema. Putting it in `app` collides with the `CREATE SCHEMA "app"` in `drizzle/0000_*.sql` (Postgres 42P06).
- The runtime image contains only `.mastra/output` — **no `package.json`, so no `npm run`**. `scripts/*.mjs` are plain ESM copied into that bundle and resolve `pg` / `drizzle-orm` / `@mastra/pg` from the bundle's own `node_modules`.

### Multi-tenancy — do not weaken this

`user_id` comes from `message.author.userId` (signed Bot Framework payload), is stamped into
`ctx.requestContext` by the Teams handler, and reaches tools via `requireUserId()`
(`tools/tool-context.ts`). It is **not** in any tool's `inputSchema`, so the model cannot set it.
Never add it as a tool input, and never add a repository function that omits the `userId`
argument — `updateReceipt` matches on `(id, user_id)` precisely so a guessed id hits 0 rows.

### Constraints that live in more than one file

- Max upload size is asserted in `upload-store.ts`, `server.bodySizeLimit` (`index.ts`), the Teams handler, and `frontend/lib/receipt-uploads.ts`. Change all of them together.
- Allowed file types: `ALLOWED_UPLOAD_TYPES` (`upload-store.ts`), `MIME_BY_EXT` (both `receipt-workflow.ts` and `server/receipt-routes.ts`), plus the frontend adapter. PDF is intentionally excluded — providers reject it as an image part.
- `MASTRA_MODEL` **must** be vision-capable; a non-vision model fails deep inside the workflow ("No endpoints found that support image input"). `annotateModelError()` in the Teams handler exists to surface which model was configured.
- Teams reports inline-pasted images as `image/*` or `application/octet-stream`, so the real format is sniffed from magic bytes in `detectImageMime()` rather than trusted from `contentType`.

## Conventions

- Comments and all user-facing strings (agent instructions, error messages, tool descriptions) are **German**. `receipt-agent.ts` / `receipt-workflow.ts` internals are English. Match the file you're editing.
- Comments in this codebase explain *why* a non-obvious choice was made (route naming, `0.0.0.0` binding, sequential extraction). Keep that style rather than restating code.
- Persistence is split: structured data in Postgres (schemas `mastra` and `app`), receipt *images* still as files under `./data/uploads/`. `receipts.file_reference` holds `local:uploads/<id>` — there is no object store yet, and that prefix scheme exists so adding one is a data migration over one column.
- `RECEIPT_DATA_DIR` defaults to `/app/data`, so running the backend outside Docker without setting it writes to an absolute container path.
- Retention policies live in **one** place, `scripts/prune.mjs`, which passes them per call to `storage.prune()`. `src/mastra/storage.ts` deliberately configures none — two definitions would drift.

## Notes

- `README.md` (German) is the authoritative operational doc: env var table, Railway deployment, Azure Bot registration, and the two browser→Mastra wiring variants.
- `frontend/.claude/skills/` and `frontend/.agents/` are assistant-ui reference docs shipped by its scaffolder — useful when working on the frontend, excluded from the Docker build.
- Known open issues by design: no auth on Studio or `POST /receipts/upload`; single-process SQLite (use `@mastra/pg` or Turso for replicas); uploads are never garbage-collected.
