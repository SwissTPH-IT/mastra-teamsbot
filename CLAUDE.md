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

API service (`api/` — also an npm workspace of the repo root, Hono):

```bash
npm run dev --workspace api        # tsx watch, http://localhost:4000
npm run typecheck --workspace api
```

Needs `DATABASE_URL` and `API_SERVICE_TOKEN` (min. 32 chars — it throws on start
without it). `ENTRA_TENANT_ID` / `ENTRA_API_AUDIENCE` are optional; without them
only the service-token path works and user tokens get a 401.

Frontend (`frontend/` — an **npm workspace of the repo root**, not a separate
project; `npm install` runs at the root):

```bash
npm run dev              # next dev --turbopack, http://localhost:3000
npm run build            # next build (output: standalone)
npm run typecheck        # tsc --noEmit
npm run lint             # oxlint && oxfmt --check
npm run lint:fix
```

Never run `npm install` inside `frontend/`. It creates a nested `node_modules`
that shadows the hoisted one, and the frontend then builds against a second copy
of React/Next.

Docker (all services): `docker compose up --build`. The images are production builds,
so there is no hot reload inside the container — run `npm run dev` on the host instead.
Frontend-only dev against a containerized backend: `docker compose up postgres api mastra -d`,
then `cd frontend && cp .env.example .env.local && npm run dev`. The frontend needs
`api` (all data) and `mastra` (receipt images only), not `DATABASE_URL`.

Before pushing: `npm run typecheck && npm run build`.

`tests/suspend-resume.test.ts` is the only backend test; it needs a real Postgres and
`describe.skip`s itself without `TEST_DATABASE_URL`. There is no backend lint config —
`typecheck` + `build` are the gate.

## Architecture

A receipt-capture app: images in, structured JSON out. **Capture happens only in
Microsoft Teams.** The Next.js frontend is each person's view of their own captured
data — sign in with Entra, see, check and correct your own receipts, export them.

```
Teams ─► POST /api/agents/teams-agent/channels/teams/webhook
           └─ handleTeamsReceipt ─► receipt-review-workflow
                                      ├─ receipt-extraction-workflow (nested)
                                      │    load → extract → write-json
                                      ├─ review-candidate ─► suspend ─► Adaptive Card im Thread
                                      │      ▲                              │
                                      │      └──── run.resume() ◄───────────┘
                                      │        (Button/Dialog über chat.onAction, oder Text)
                                      └─ persist-receipt ─► app.receipts

Browser ─► Frontend (Entra login, Auth.js)   ──► receipt-api ─► app.receipts
             /, /receipts, /receipts/<id>          Bearer API_SERVICE_TOKEN
             /api/export                           X-Subject-Aad: <oid>
             /api/receipts/<id>/image ─► GET /receipts/<uploadId>/file (to the agent)
```

Four invariants to preserve:

1. **Extraction lives only in `receipt-extraction-workflow`.** The review workflow nests it;
   `extract-receipt-tool.ts` calls it directly. It never suspends — only the Teams path has
   a channel for the follow-up question.
2. **Image bytes never travel through chat context.** Every entry point stores the file via
   `receipts/upload-store.ts`, gets an `uploadId`, and passes only file *paths* onward.
3. **Nothing is written to the DB before the user confirms.** No write-then-clean-up.
4. **The frontend has no database.** No pool, no Drizzle, no schema import, no
   migrations — every byte of receipt data comes from `api/`, and every write goes
   through `api/` too: `PATCH /receipts/:id` for corrections (category, receipt type
   and the fact fields), `POST /receipts/manual` for an expense without receipt, and
   the `/settlements` endpoints (create, assign, remove, submit, delete draft).

Key pieces (`src/mastra/`):

- `index.ts` — the `Mastra` instance: agent registry, workflow, `chatRoute()`, receipt routes, CORS, body size limit.
- `workflows/receipt-extraction-workflow.ts` — three steps: read file → data URL, call `receipt-extraction-agent` with `structuredOutput`, write `<RECEIPT_DATA_DIR>/receipts/<id>.json`.
- `workflows/receipt-review-workflow.ts` — the human-in-the-loop path. `review-candidate` is one step that calls `suspend()` repeatedly: no `resumeData` → present; `confirm` → proceed; `correct` → apply free-text via `receipt-correction-agent`, then present *again*. Candidate + round counter live in workflow state (`setState`), so they land in `mastra_workflow_snapshot` and survive a deploy.
- `receipts/candidate.ts` — the only place the extraction output is *interpreted*: markers → null, `"CHF 42.10"` → amount + ISO currency, dates → `YYYY-MM-DD`, plus the deterministic `computeConfidence()`.
- `db/` — `pool.ts` (the single `pg.Pool`), `schema.ts` (Drizzle, all inside `pgSchema('app')`), `receipts.ts` and `settlements.ts` (repositories; **every** function takes `userId` first and puts it in every `WHERE`). A receipt sits in at most one settlement (`receipts.settlement_id`, no join table). `submitted` locks a settlement: `receiptIsEditable()` is part of the `WHERE` of every receipt write (PATCH, re-upload upsert, assignment), so a locked receipt hits 0 rows and the API answers 409 — the check is in the same statement, never a separate SELECT before. Period, count and sums are computed from the receipts, never stored.
- `agents/receipt-agent.ts` — vision agent + `receiptSchema` (the source of truth for the receipt shape; every field is a string, with `NOT_PRESENT` / `ILLEGIBLE` markers instead of blanks).
- `agents/receipt-chat-agent.ts` + `tools/extract-receipt-tool.ts` — the former web chat path; the tool resolves `uploadId`s to paths and runs the workflow sequentially. No caller today (see Notes).
- `agents/teams-agent.ts` + `channels/teams-receipt-handler.ts` — the Teams path. Message *with* image → start a review run. Message *without* → if `app.pending_reviews` has a row for this thread, it's the answer to a pending presentation (`classifyReply` → `run.resume()`); otherwise `defaultHandler` (the model, with the DB tools).
- `channels/receipt-review-card.ts` + `channels/receipt-card-handlers.ts` + `channels/receipt-review-session.ts` — the presentation is an **Adaptive Card** (Bestätigen / Anpassen / Abbrechen). A card click is not a message in Teams: the adapter sees `value.actionId` and routes it to `chat.processAction`, so the message handlers never see it. Own handlers therefore hang off `agent.getChannels().sdk` (`onAction` / `onModalSubmit`), registered once at startup in `index.ts` — not on the first receipt, or a card posted before a deploy would be dead after it. Mastra registers its own catch-all `onAction` for tool approvals and ignores foreign ids; handlers are additive, hence the `receipt-review:` prefix, with the runId in the action id so a stale card cannot confirm a newer receipt. `receipt-review-session.ts` is the shared middle of both paths (resume + report): whether a booking is written must not depend on clicking versus typing. A card cannot carry inputs (`CardChild` has none) — so "Anpassen" is a button with `actionType: 'modal'` (→ `msteams: task/fetch`) opening a Teams dialog for exactly the four confirmable fields: date, currency, tax, total. Dialog input goes through `applyReviewEdits()` in `receipts/candidate.ts` — the same parsers as extraction; empty means null, unreadable re-opens the dialog with the message instead of silently storing null. The dialog submit *is* the confirmation (`resumeData.kind === 'edit'`). Free text in the thread still works and re-presents the card.
- `tools/receipt-db-tools.ts` + `tools/tool-context.ts` + `api-client.ts` — four narrow tools, no generic SQL. They call the **API service** (`api/`, Hono) over HTTP, not Drizzle: the agent can only do what the service exposes. Same in- and output schemas as before. `userId` travels as `X-Subject-User` and is never a tool input. Still direct in the agent, deliberately: `app.pending_reviews` and schema `mastra` (PostgresStore).
- `receipts/upload-store.ts` — allowed types (JPG/PNG/WebP/GIF only), `MAX_UPLOAD_BYTES` (15 MB), and `UPLOAD_ID_PATTERN`. The strict `<uuid><ext>` pattern *is* the path-traversal defense — don't loosen it.
- `storage.ts` / `model.ts` — single points for `PostgresStore` (schema `mastra`, `disableInit: true`) and the `MASTRA_MODEL` choice.

### The frontend talks to the API, not to the database

`frontend/` is an npm workspace of the repo root (`"workspaces": ["frontend", "api"]`),
but since the switch to the API service it imports **nothing** from `src/`: no
schema, no repository, no `drizzle-orm`, no `pg`. `transpilePackages` and the
frontend's own pool are gone. It is a workspace only so that one lockfile covers
all three projects.

Every read and the one write go through `frontend/lib/api/client.ts`, with two
server-side headers:

```
Authorization: Bearer <API_SERVICE_TOKEN>   who calls  (this service)
X-Subject-Aad: <oid from the session>       on whose behalf
```

The service resolves `oid → teams_user_id` via `app.users` and puts that id in
every `WHERE` (`api/src/auth.ts`). So the frontend never learns the Teams userId,
and there is no `ReceiptScope` to widen any more — the former one meant "all users"
and was the hook for adding auth; the hook is now the service.

**The service token is the thing to be careful with.** It lets this process act for
any user. The rule in `client.ts` has no exception: the subject comes from the
**session** (`oid` out of the signed ID token), never from a browser request, and
there is deliberately no function that takes a subject as an argument. `client.ts`
is `server-only`, so an accidental import into a client component fails the build.

A per-user access token for the API (OBO) is the stricter variant and needs a second
Entra app registration ("expose an API" + scope). It does not exist; the service
already accepts user JWTs (`ENTRA_API_AUDIENCE`), so the switch is `auth.ts`
requesting the scope and `client.ts` sending that token instead.

Login: Auth.js v5 (`frontend/auth.ts`), Entra provider, JWT session cookie, scope
`openid profile email` only — the UI calls no Graph API, and the provider's default
`profile()` (which fetches a Graph photo) is replaced. `frontend/proxy.ts` — in Next
16 the successor to `middleware.ts` — gates everything with a **positive list of the
public**: `/api/healthz`, `/api/auth/*`, `/signin`. The other way round every new
route would be public by accident.

Three frontend details that look like style but are not:

- `receipt_date` is a calendar day, `created_at` a timestamp. Never run a calendar
  day through a timezone conversion — see `frontend/lib/receipts/format.ts`. The
  period filter is on `receipt_date`, deliberately.
- Amounts are **strings** end to end. The CSV export keeps the string and only swaps
  the decimal separator; only display goes through `Number()`.
- An unlinked account (signed in, no `app.users` row for that `oid`) gets a `403` from
  the service and an explanation in the UI, never an empty table. `isUnlinkedAccount()`
  in `lib/api/client.ts`, rendered by `components/receipts/states.tsx`.

There is no `app/(app)/receipts/loading.tsx` on purpose: a `loading.tsx` also covers
child segments, so `/receipts/<id>` would start streaming before `notFound()` runs and
the 404 page would go out with status 200. The Suspense boundary sits in
`app/(app)/receipts/page.tsx` instead.

The UI text is **English**, taken from the `dev/Swiss TPH Expenses.html` mockup;
comments and error messages stay German like the rest of the repo. Settlements exist
with two states, `draft` and `submitted`; the mockup's Approved/Query need a Finance
review role that does not exist, so those tiles are visibly greyed out rather than
hidden — `frontend/README.md` lists every greyed element and every deviation from the
mockup. Settlement errors carry a machine `code` (`locked`, `receipts-unavailable`,
`empty`, `incomplete`) next to the German `error`; the frontend words its English
message from the code, never from the German text.

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

Settlements add a second layer that does not depend on query code: the foreign key is
`receipts(settlement_id, user_id) -> settlements(id, user_id)` (hence the
`UNIQUE (id, user_id)` on settlements). Postgres itself rejects a receipt of A in a
settlement of B. Keep it composite; a plain FK on `settlement_id` would silently allow
exactly that. It has no `ON DELETE` (`SET NULL` would also null `user_id`) —
`deleteSettlement()` unassigns in the same transaction first.

### Constraints that live in more than one file

- The no-receipt limit (20.00 CHF per item, nominal amount, no FX conversion) is decided in `src/mastra/receipts/no-receipt.ts` and checked by the API on `POST /receipts/manual` **and** on every `PATCH` of a row without a file. `frontend/lib/receipts/no-receipt.ts` only mirrors it for the live hint — change both.
- Corrections: `updateReceipt()` sets `corrected_at` and recomputes `confidence` only when a fact field actually changes (`CORRECTION_FIELDS`; category/receipt type don't count). `needsReview()` in the frontend returns false once `correctedAt` is set.
- API rejections carry machine-readable `code` / `fields` next to the German `error` (`api/src/validate.ts`, `ErrorDetail`); the frontend words its English messages from those (`lib/receipts/form-state.ts`) instead of parsing the text.

- Max upload size is asserted in `upload-store.ts`, `server.bodySizeLimit` (`index.ts`), and the Teams handler. Change all of them together.
- Allowed file types: `ALLOWED_UPLOAD_TYPES` (`upload-store.ts`) and `MIME_BY_EXT` (both `receipt-extraction-workflow.ts` and `server/receipt-routes.ts`). PDF is intentionally excluded — providers reject it as an image part.
- `MASTRA_MODEL` **must** be vision-capable; a non-vision model fails deep inside the workflow ("No endpoints found that support image input"). `annotateModelError()` in the Teams handler exists to surface which model was configured.
- Teams reports inline-pasted images as `image/*` or `application/octet-stream`, so the real format is sniffed from magic bytes in `detectImageMime()` rather than trusted from `contentType`.

## Conventions

- Comments and all user-facing strings (agent instructions, error messages, tool descriptions) are **German**. `receipt-agent.ts` / `receipt-extraction-workflow.ts` internals are English. Match the file you're editing. In the frontend, comments, commit-relevant prose and error logs are German, but the **UI text is English** — it comes verbatim from the mockup. Numbers and dates stay Swiss (de-CH).
- Comments in this codebase explain *why* a non-obvious choice was made (route naming, `0.0.0.0` binding, sequential extraction). Keep that style rather than restating code.
- **Deployment config lives in `.railway/railway.ts`** (Railway Infrastructure as Code), not in `railway.json`. Config as Code is deprecated: existing files work until 2026-12-01, and since 2026-08-28 a service that never used it **cannot opt in** — so the new frontend service could not have a `railway.frontend.json` at all. The file is applied by CLI (`railway config pull --force` → `plan` → `apply`), once per environment, never at deploy time. Read the `plan` output before applying; a service-name mismatch reads as create-new + destroy-old. `railway.json` / `railway.prune.json` still sit in the repo and still drive the agent and prune services; they get deleted right after the first successful `apply`, not before.
- In that file: `dockerfilePath` is a per-service option, so one repo serving three services needs no per-service config file. `DATABASE_URL` is a real reference (`db.env.DATABASE_URL`). Secrets use `preserve()` — never put them in the repo. `MASTRA_URL` must be a **literal** string with Railway's `${{Service.VAR}}` syntax, because a composed value cannot interpolate a reference object (`agent.env.RAILWAY_PRIVATE_DOMAIN` would stringify to `[object Object]`); `privateUrl()` wraps that.
- The prune service is selected by `RUN_MODE=prune`, not a start command — `scripts/docker-entrypoint.sh` switches roles on that variable, because start commands from platform config were silently not applied in this project while variables demonstrably arrive.
- The frontend image builds from the **repo root** context (`docker build -f frontend/Dockerfile .`), because `npm ci` needs the root lockfile plus every workspace's `package.json`. It no longer copies `src/db`. `output: standalone` leaves out both `.next/static` and `public/`, so the Dockerfile copies both — without `public/` the wordmark is missing. The root `.dockerignore` therefore no longer excludes `frontend/`, and the agent's Dockerfile copies `frontend/package.json` so `npm ci --workspaces=false` can validate the lockfile.
- Persistence is split: structured data in Postgres (schemas `mastra` and `app`), receipt *images* still as files under `./data/uploads/`. `receipts.file_reference` holds `local:uploads/<id>` — there is no object store yet, and that prefix scheme exists so adding one is a data migration over one column.
- `receipts.file_reference IS NULL` **is** "expense without receipt" — there is no separate `source` column that could contradict it. Such rows have no `file_hash`, `raw_extraction` or `confidence`, must have a `reason` (DB `CHECK receipts_reason_without_file`), and are idempotent via the row `id`, which the form assigns at render time (`createManualReceipt()`).
- `RECEIPT_DATA_DIR` defaults to `/app/data`, so running the backend outside Docker without setting it writes to an absolute container path.
- Retention policies live in **one** place, `scripts/prune.mjs`, which passes them per call to `storage.prune()`. `src/mastra/storage.ts` deliberately configures none — two definitions would drift.

## Notes

- `README.md` (German) is the authoritative operational doc: env var table, Railway deployment, Azure Bot registration, and the two browser→Mastra wiring variants.
- `frontend/README.md` covers the web UI on its own: the API-only data path, the Entra login, what is greyed out, the deviations from the mockup, and the CSV/Excel details.
- Known open issues by design: no auth on Studio or `POST /receipts/upload`; `GET /receipts/:uploadId/file` on the agent is unauthenticated too, which is why the frontend proxies it behind its own check (`app/api/receipts/[id]/image`); uploads are never garbage-collected. The web UI now requires a login and shows only the signed-in person's receipts.
- `chatRoute()` with `receiptChatAgent` / `extract-receipt-tool` and `POST /receipts/upload` currently have **no caller** — the web upload path was removed with assistant-ui. They stay reachable via Studio and the REST API. `GET /receipts/:uploadId/file` *is* used: the detail page proxies the receipt image through it.
