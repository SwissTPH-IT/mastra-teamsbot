# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Backend (repo root, Node >= 22):

```bash
docker compose up postgres -d   # required for almost everything below
npm run dev              # mastra dev — hot reload, http://localhost:4111
npm run build            # mastra build --studio  (output: .mastra/output/index.mjs)
npm run typecheck        # tsc --noEmit — also covers .railway/railway.ts
npm test                 # vitest run (needs TEST_DATABASE_URL, else skipped)
npm run db:generate      # drizzle-kit generate — after editing src/db/schema.ts
npm run db:deploy        # drizzle migrations + storage.init(); same cmd Railway runs
npm run db:prune         # apply retention policies via storage.prune()
npm run teams:manifest   # TEAMS_APP_ID=<guid> node teams-app/build.mjs -> teams-app/dist/teams-app.zip
```

`DATABASE_URL=postgres://mastra:mastra@localhost:5432/mastra` for all of these locally.

Frontend (`frontend/` — an **npm workspace of the repo root**, not a separate
project; `npm install` runs at the root):

```bash
npm run dev              # next dev --turbopack, http://localhost:3000
npm run build            # next build (output: standalone)
npm run typecheck        # tsc --noEmit
npm run lint             # oxlint && oxfmt --check
npm run lint:fix
```

Never run `npm install` inside `frontend/`. It creates a nested `node_modules` and
defeats the hoisting that keeps a single `drizzle-orm` copy — see "The frontend
imports the schema" below.

Docker (all services): `docker compose up --build`. The images are production builds,
so there is no hot reload inside the container — run `npm run dev` on the host instead.
Frontend-only dev against a containerized backend: `docker compose up postgres mastra -d`,
then `cd frontend && cp .env.example .env.local && npm run dev`.

Before pushing: `npm run typecheck && npm run build`.

`tests/suspend-resume.test.ts` is the only backend test; it needs a real Postgres and
`describe.skip`s itself without `TEST_DATABASE_URL`. There is no backend lint config —
`typecheck` + `build` are the gate.

## Architecture

A receipt-capture app: images in, structured JSON out. **Capture happens only in
Microsoft Teams.** The Next.js frontend is a read-only view on the captured data
for the finance team.

```
Teams ─► POST /api/agents/teams-agent/channels/teams/webhook
           └─ handleTeamsReceipt ─► receipt-review-workflow
                                      ├─ receipt-extraction-workflow (nested)
                                      │    load → extract → write-json
                                      ├─ review-candidate ─► suspend ─► Vorlage im Thread
                                      │      ▲                              │
                                      │      └──── run.resume() ◄───────────┘
                                      └─ persist-receipt ─► app.receipts

Browser ─► /belege, /api/export ─► app.receipts   (read-only, Drizzle, server-side)
           /api/belege/<id>/bild ─► GET /receipts/<uploadId>/file  (proxy to the agent)
```

Four invariants to preserve:

1. **Extraction lives only in `receipt-extraction-workflow`.** The review workflow nests it;
   `extract-receipt-tool.ts` calls it directly. It never suspends — only the Teams path has
   a channel for the follow-up question.
2. **Image bytes never travel through chat context.** Every entry point stores the file via
   `receipts/upload-store.ts`, gets an `uploadId`, and passes only file *paths* onward.
3. **Nothing is written to the DB before the user confirms.** No write-then-clean-up.
4. **The frontend is read-only and owns no schema.** No write routes, no migrations, no
   table definitions, and it never touches `mastra_*` tables.

Key pieces (`src/mastra/`):

- `index.ts` — the `Mastra` instance: agent registry, workflow, `chatRoute()`, receipt routes, CORS, body size limit.
- `workflows/receipt-extraction-workflow.ts` — three steps: read file → data URL, call `receipt-extraction-agent` with `structuredOutput`, write `<RECEIPT_DATA_DIR>/receipts/<id>.json`.
- `workflows/receipt-review-workflow.ts` — the human-in-the-loop path. `review-candidate` is one step that calls `suspend()` repeatedly: no `resumeData` → present; `confirm` → proceed; `correct` → apply free-text via `receipt-correction-agent`, then present *again*. Candidate + round counter live in workflow state (`setState`), so they land in `mastra_workflow_snapshot` and survive a deploy.
- `receipts/candidate.ts` — the only place the extraction output is *interpreted*: markers → null, `"CHF 42.10"` → amount + ISO currency, dates → `YYYY-MM-DD`, plus the deterministic `computeConfidence()`.
- `db/` — `pool.ts` (the single `pg.Pool`), `schema.ts` (Drizzle, all inside `pgSchema('app')`), `receipts.ts` (repository; **every** function takes `userId` first and puts it in every `WHERE`).
- `agents/receipt-agent.ts` — vision agent + `receiptSchema` (the source of truth for the receipt shape; every field is a string, with `NOT_PRESENT` / `ILLEGIBLE` markers instead of blanks).
- `agents/receipt-chat-agent.ts` + `tools/extract-receipt-tool.ts` — the former web chat path; the tool resolves `uploadId`s to paths and runs the workflow sequentially. No caller today (see Notes).
- `agents/teams-agent.ts` + `channels/teams-receipt-handler.ts` — the Teams path. Message *with* image → start a review run. Message *without* → if `app.pending_reviews` has a row for this thread, it's the answer to a pending presentation (`classifyReply` → `run.resume()`); otherwise `defaultHandler` (the model, with the DB tools).
- `tools/receipt-db-tools.ts` + `tools/tool-context.ts` — four narrow tools, no generic SQL.
- `receipts/upload-store.ts` — allowed types (JPG/PNG/WebP/GIF only), `MAX_UPLOAD_BYTES` (15 MB), and `UPLOAD_ID_PATTERN`. The strict `<uuid><ext>` pattern *is* the path-traversal defense — don't loosen it.
- `storage.ts` / `model.ts` — single points for `PostgresStore` (schema `mastra`, `disableInit: true`) and the `MASTRA_MODEL` choice.

### The frontend imports the schema, it does not own it

`frontend/` is an npm workspace of the repo root (`"workspaces": ["frontend"]`) and
imports `mastra-teamsbot/db/schema` — i.e. `src/db/schema.ts` — via
`transpilePackages: ['mastra-teamsbot']`. Two reasons it is a workspace and not a
path alias to `../src/db`:

- An import outside the Next project root needs `experimental.externalDir`, which has
  been broken since Next 15 (vercel/next.js#81177).
- npm hoists `drizzle-orm` to the root `node_modules`, so there is exactly **one**
  copy. With two copies the table objects come from one and the Drizzle client from
  the other — nominally different types, and it only surfaces when building a query.

The frontend does **not** import `src/db/index.ts` or `src/db/pool.ts`: it holds its
own smaller pool (`frontend/lib/db/client.ts`, `FRONTEND_DB_POOL_MAX`, default 3,
lazily created so `next build` needs no `DATABASE_URL`). It also does not use
`src/db/receipts.ts` — that repository enforces per-user tenancy, and the finance
view is deliberately cross-user.

Three places carry the design intent, keep them that way:

- `frontend/lib/receipts/scope.ts` — every query takes a `ReceiptScope` first. It
  means "all users" today; replacing `resolveScope()` is the whole of adding auth.
- `frontend/lib/receipts/where.ts` — the **only** place filters become a WHERE clause.
  No filter logic in components.
- `frontend/app/api/export/route.ts` — the export reuses that same query layer
  (`streamReceipts`), so a later permission filter cannot be bypassed by exporting.

Two frontend details that look like style but are not:

- `receipt_date` is a `date`, `created_at`/`updated_at` are `timestamptz`. Never run a
  calendar day through a timezone conversion — see `frontend/lib/receipts/format.ts`.
  The date-range filter is on `receipt_date`, deliberately.
- `numeric` arrives as a **string** from node-postgres. The CSV export keeps the
  string and only swaps the decimal separator; only display goes through `Number()`.

There is no `app/belege/loading.tsx` on purpose: a `loading.tsx` also covers child
segments, so `/belege/<id>` would start streaming before `notFound()` runs and the
404 page would go out with status 200. The Suspense boundary sits in
`app/belege/page.tsx` instead.

### Routing and API gotchas

- **Chat route `:agentId` is the registry key** in `index.ts` (`receiptChatAgent`), not the agent's `id`.
- **Teams webhook path uses the agent's `id`** (`teams-agent`), not the key (`teamsAgent`). Changing that `id` changes the Azure messaging endpoint.
- Custom routes deliberately avoid the `/api` prefix — Mastra reserves it. In the Next frontend the opposite holds: everything server-side lives under `app/api/`, so its health check is `/api/healthz`.
- **`/health` is taken by Mastra** and silently wins over a custom route of the same name (it returns `{"success":true}` with no DB check). Ours is `/healthz`.
- **In Mastra v1 the mechanism is `RequestContext`**, from `@mastra/core/request-context` — not `runtimeContext`.
- A workflow with a `stateSchema` **requires `initialState` at `run.start()`**, else it throws `Invalid initial data`. Hence `initialReviewState`.
- `drizzle-kit`'s migration journal lives in its own `drizzle` schema. Putting it in `app` collides with the `CREATE SCHEMA "app"` in `drizzle/0000_*.sql` (Postgres 42P06).
- **Migrations run from the Dockerfile `CMD`** (`migrate.mjs && index.mjs`), not from Railway's `preDeployCommand` or `startCommand` — both were configured and silently not applied, leaving the agent crash-looping on `relation "mastra.mastra_schedules" does not exist` (Mastra reads `mastra_schedules` and `mastra_workflow_definitions` at boot and aborts if missing). The `CMD` is the image's own default, so it works even when platform config isn't applied; `railway.json` sets the identical command as `startCommand`. Both steps are idempotent, so re-running on every container start is fine.
- Railway's internal `DATABASE_URL` (`*.railway.internal`) is **not** reachable from a dev machine. For an out-of-band migration, enable Public Networking on the Postgres service and use `DATABASE_PUBLIC_URL`.
- **Two Railway services build from this repo**, distinguished only by their config file: the agent uses `railway.json` (default), the prune cron uses `/railway.prune.json` (set per service under Settings). Railway config-as-code *overrides* dashboard settings, so a start command typed into the UI would be ignored — the second config file is not optional.
- The runtime image contains only `.mastra/output` — **no `package.json`, so no `npm run`**. `scripts/*.mjs` are plain ESM copied into that bundle and resolve `pg` / `drizzle-orm` / `@mastra/pg` from the bundle's own `node_modules`.

### Multi-tenancy — do not weaken this

`user_id` comes from `message.author.userId` (signed Bot Framework payload), is stamped into
`ctx.requestContext` by the Teams handler, and reaches tools via `requireUserId()`
(`tools/tool-context.ts`). It is **not** in any tool's `inputSchema`, so the model cannot set it.
Never add it as a tool input, and never add a repository function that omits the `userId`
argument — `updateReceipt` matches on `(id, user_id)` precisely so a guessed id hits 0 rows.

### Constraints that live in more than one file

- Max upload size is asserted in `upload-store.ts`, `server.bodySizeLimit` (`index.ts`), and the Teams handler. Change all of them together.
- Allowed file types: `ALLOWED_UPLOAD_TYPES` (`upload-store.ts`) and `MIME_BY_EXT` (both `receipt-extraction-workflow.ts` and `server/receipt-routes.ts`). PDF is intentionally excluded — providers reject it as an image part.
- `MASTRA_MODEL` **must** be vision-capable; a non-vision model fails deep inside the workflow ("No endpoints found that support image input"). `annotateModelError()` in the Teams handler exists to surface which model was configured.
- Teams reports inline-pasted images as `image/*` or `application/octet-stream`, so the real format is sniffed from magic bytes in `detectImageMime()` rather than trusted from `contentType`.

## Conventions

- Comments and all user-facing strings (agent instructions, error messages, tool descriptions) are **German**. `receipt-agent.ts` / `receipt-extraction-workflow.ts` internals are English. Match the file you're editing. The frontend is German throughout, including comments; its UI text avoids umlauts in a few identifiers only where a filename or CSV header travels into Excel.
- Comments in this codebase explain *why* a non-obvious choice was made (route naming, `0.0.0.0` binding, sequential extraction). Keep that style rather than restating code.
- **Deployment config lives in `.railway/railway.ts`** (Railway Infrastructure as Code), not in `railway.json`. Config as Code is deprecated: existing files work until 2026-12-01, and since 2026-08-28 a service that never used it **cannot opt in** — so the new frontend service could not have a `railway.frontend.json` at all. The file is applied by CLI (`railway config pull --force` → `plan` → `apply`), once per environment, never at deploy time. Read the `plan` output before applying; a service-name mismatch reads as create-new + destroy-old. `railway.json` / `railway.prune.json` still sit in the repo and still drive the agent and prune services; they get deleted right after the first successful `apply`, not before.
- In that file: `dockerfilePath` is a per-service option, so one repo serving three services needs no per-service config file. `DATABASE_URL` is a real reference (`db.env.DATABASE_URL`). Secrets use `preserve()` — never put them in the repo. `MASTRA_URL` must be a **literal** string with Railway's `${{Service.VAR}}` syntax, because a composed value cannot interpolate a reference object (`agent.env.RAILWAY_PRIVATE_DOMAIN` would stringify to `[object Object]`); `privateUrl()` wraps that.
- The prune service is selected by `RUN_MODE=prune`, not a start command — `scripts/docker-entrypoint.sh` switches roles on that variable, because start commands from platform config were silently not applied in this project while variables demonstrably arrive.
- The frontend image builds from the **repo root** context (`docker build -f frontend/Dockerfile .`), because it needs `src/db` and the root lockfile. The root `.dockerignore` therefore no longer excludes `frontend/`, and the agent's Dockerfile copies `frontend/package.json` so `npm ci --workspaces=false` can validate the lockfile.
- Persistence is split: structured data in Postgres (schemas `mastra` and `app`), receipt *images* still as files under `./data/uploads/`. `receipts.file_reference` holds `local:uploads/<id>` — there is no object store yet, and that prefix scheme exists so adding one is a data migration over one column.
- `RECEIPT_DATA_DIR` defaults to `/app/data`, so running the backend outside Docker without setting it writes to an absolute container path.
- Retention policies live in **one** place, `scripts/prune.mjs`, which passes them per call to `storage.prune()`. `src/mastra/storage.ts` deliberately configures none — two definitions would drift.

## Notes

- `README.md` (German) is the authoritative operational doc: env var table, Railway deployment, Azure Bot registration, and the two browser→Mastra wiring variants.
- `frontend/README.md` covers the web UI on its own: layout, the CSV/Excel details, and why it is unauthenticated.
- Known open issues by design: no auth on Studio, `POST /receipts/upload`, or the web UI (which shows every user's receipts — `frontend/lib/receipts/scope.ts` is where a permission filter goes); uploads are never garbage-collected.
- `chatRoute()` with `receiptChatAgent` / `extract-receipt-tool` and `POST /receipts/upload` currently have **no caller** — the web upload path was removed with assistant-ui. They stay reachable via Studio and the REST API. `GET /receipts/:uploadId/file` *is* used: the detail page proxies the receipt image through it.
