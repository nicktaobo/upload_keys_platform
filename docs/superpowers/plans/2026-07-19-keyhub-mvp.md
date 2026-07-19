# KeyHub MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a multi-user KeyHub portal that relays Claude Keys through one authorized upstream supplier account while isolating each user's records and synchronizing status and usage.

**Architecture:** A pnpm TypeScript workspace contains a React/Ant Design web app, a Fastify API, a BullMQ worker, and shared domain/upstream packages. PostgreSQL stores users, encrypted Keys, upstream mappings, and job history; Redis stores sessions, rate limits, queues, and locks.

**Tech Stack:** Node.js 22, TypeScript, pnpm workspaces, React 19, Vite, Ant Design, Fastify, Prisma, PostgreSQL 16, Redis 7, BullMQ, Vitest, Playwright, Docker Compose.

---

## File Map

- `apps/api/src/`: Fastify bootstrap, auth, user, Key, admin, and health routes.
- `apps/worker/src/`: BullMQ processors and five-minute scheduler.
- `apps/web/src/`: React application, authentication shell, user pages, and admin pages.
- `packages/config/src/`: validated environment configuration.
- `packages/domain/src/`: Key parsing, masking, cryptography, statuses, and shared schemas.
- `packages/database/`: Prisma schema, migrations, generated client, and seed script.
- `packages/upstream/src/`: session/CSRF HTTP client and response mapping.
- `packages/queue/src/`: queue names, job payloads, and queue factories.
- `tests/e2e/`: browser isolation and workflow tests.
- `docker/`: production container definitions and reverse-proxy example.

### Task 1: Workspace and Quality Gates

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `vitest.workspace.ts`
- Create: `.env.example`

- [ ] **Step 1: Add a failing workspace smoke test**

Create `packages/domain/src/smoke.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { APP_NAME } from "./index.js";

describe("domain package", () => {
  it("exports the product name", () => expect(APP_NAME).toBe("KeyHub"));
});
```

- [ ] **Step 2: Run the test and verify the missing workspace failure**

Run: `pnpm test`
Expected: FAIL because the root package and domain module do not exist.

- [ ] **Step 3: Create the pnpm workspace and minimal domain export**

Root scripts must include `build`, `dev`, `lint`, `typecheck`, `test`, and `test:e2e`. Add `packages/domain/package.json` and `packages/domain/src/index.ts`:

```ts
export const APP_NAME = "KeyHub";
```

- [ ] **Step 4: Install dependencies and pass quality gates**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: dependency installation succeeds; smoke test and TypeScript checks pass.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json eslint.config.js vitest.workspace.ts .env.example pnpm-lock.yaml packages/domain
git commit -m "chore: scaffold KeyHub workspace"
```

### Task 2: Key Parsing, Masking, Deduplication, and Encryption

**Files:**
- Create: `packages/domain/src/keys.ts`
- Create: `packages/domain/src/keys.test.ts`
- Create: `packages/domain/src/crypto.ts`
- Create: `packages/domain/src/crypto.test.ts`
- Modify: `packages/domain/src/index.ts`

- [ ] **Step 1: Write parsing and masking tests**

Cover a valid single Key, comma and whitespace batch formats, invalid warranty hours, within-batch duplicates, masking, and stable HMAC fingerprints:

```ts
expect(parseBatch("sk-ant-a, 24\nsk-ant-b 48")).toEqual([
  { apiKey: "sk-ant-a", warrantyHours: 24 },
  { apiKey: "sk-ant-b", warrantyHours: 48 },
]);
expect(maskKey("sk-ant-api03-abcdefX7AA")).toBe("sk-ant-****X7AA");
expect(fingerprintKey("sk-ant-a", Buffer.alloc(32, 7))).toHaveLength(64);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm vitest packages/domain/src/keys.test.ts packages/domain/src/crypto.test.ts`
Expected: FAIL with missing exports.

- [ ] **Step 3: Implement domain functions**

Export `parseBatch`, `maskKey`, `fingerprintKey`, `encryptSecret`, and `decryptSecret`. Use Node `createHmac` and AES-256-GCM with a 12-byte random IV. Return ciphertext, IV, and auth tag as base64 strings.

- [ ] **Step 4: Pass focused tests**

Run: `pnpm vitest packages/domain/src/keys.test.ts packages/domain/src/crypto.test.ts`
Expected: all parsing, masking, fingerprint, tamper-detection, and round-trip tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "feat: add secure Key domain utilities"
```

### Task 3: Database Schema and Seed Administrator

**Files:**
- Create: `packages/database/package.json`
- Create: `packages/database/prisma/schema.prisma`
- Create: `packages/database/prisma/migrations/*/migration.sql`
- Create: `packages/database/src/client.ts`
- Create: `packages/database/src/seed.ts`
- Create: `packages/database/src/seed.test.ts`

- [ ] **Step 1: Write a database seed test**

Verify `seedAdmin()` creates one active admin, stores an Argon2id hash, and updates the hash without creating a duplicate when run again.

- [ ] **Step 2: Run the database test and verify failure**

Run: `pnpm --filter @keyhub/database test`
Expected: FAIL because the Prisma schema and seed function are missing.

- [ ] **Step 3: Define the approved schema**

Create `User`, `KeyRecord`, `UpstreamConnection`, and `JobRun` models. Add a unique index on `User.username`, a unique index on `KeyRecord.keyFingerprint`, indexes on `(ownerId, createdAt)` and `(status, updatedAt)`, and enums for roles and local Key states.

- [ ] **Step 4: Implement the client and idempotent seed**

`seedAdmin()` reads `ADMIN_USERNAME` and `ADMIN_PASSWORD`, hashes with Argon2id, and upserts the account. It must reject missing or shorter-than-12-character bootstrap passwords.

- [ ] **Step 5: Run migration and test with PostgreSQL**

Run: `docker compose up -d postgres && pnpm --filter @keyhub/database prisma migrate deploy && pnpm --filter @keyhub/database test`
Expected: migration applies and seed tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/database docker-compose.yml
git commit -m "feat: add KeyHub persistence model"
```

### Task 4: API Bootstrap, Sessions, and User Administration

**Files:**
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/plugins/auth.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/routes/admin-users.ts`
- Create: `apps/api/src/routes/auth.test.ts`
- Create: `apps/api/src/routes/admin-users.test.ts`

- [ ] **Step 1: Write failing authentication tests**

Tests must prove that valid credentials create an HttpOnly session, invalid credentials return `401`, disabled users cannot log in, `/auth/me` returns the current user, and logout invalidates the session.

- [ ] **Step 2: Write failing administrator tests**

Tests must prove that only administrators can create, disable, and reset users; reset increments `sessionVersion`; responses never contain `passwordHash`.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm --filter @keyhub/api test`
Expected: FAIL because the API application is missing.

- [ ] **Step 4: Implement Fastify bootstrap and Redis sessions**

Register secure cookies, CSRF protection, rate limiting, Prisma, Redis, and role decorators. Session values contain only `userId`, `role`, and `sessionVersion`; every authenticated request compares the stored version with PostgreSQL.

- [ ] **Step 5: Implement auth and administrator routes**

Expose `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `GET/POST /api/admin/users`, `POST /api/admin/users/:id/reset-password`, and `POST /api/admin/users/:id/status`.

- [ ] **Step 6: Pass API tests and commit**

Run: `pnpm --filter @keyhub/api test`
Expected: authentication and administration tests pass.

```bash
git add apps/api packages/config
git commit -m "feat: add local authentication and user management"
```

### Task 5: Owner-Scoped Key API

**Files:**
- Create: `apps/api/src/routes/keys.ts`
- Create: `apps/api/src/services/keys.ts`
- Create: `apps/api/src/routes/keys.test.ts`
- Create: `packages/queue/src/index.ts`

- [ ] **Step 1: Write isolation and submission tests**

Tests cover owner-scoped pagination, single and batch creation, generic global duplicate rejection, validation errors by row, masked list responses, and denial when another user guesses a record ID.

- [ ] **Step 2: Write reveal behavior tests**

```ts
const response = await ownerClient.post(`/api/keys/${record.id}/reveal`);
expect(response.statusCode).toBe(200);
expect(response.json()).toEqual({ apiKey: fullKey });

const denied = await otherClient.post(`/api/keys/${record.id}/reveal`);
expect(denied.statusCode).toBe(404);
```

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm --filter @keyhub/api test -- keys.test.ts`
Expected: FAIL with missing Key routes.

- [ ] **Step 4: Implement transactional creation and queueing**

Within a transaction, fingerprint each Key, reject existing fingerprints generically, encrypt the full value, create `pending` records, and enqueue only committed record IDs. Provide list, summary, reveal, submit, and rate-limited refresh endpoints.

- [ ] **Step 5: Pass focused and full API tests**

Run: `pnpm --filter @keyhub/api test -- keys.test.ts && pnpm --filter @keyhub/api test`
Expected: Key tests and all API tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api packages/queue
git commit -m "feat: add isolated Key submission APIs"
```

### Task 6: Upstream Supplier Adapter

**Files:**
- Create: `packages/upstream/src/client.ts`
- Create: `packages/upstream/src/contracts.ts`
- Create: `packages/upstream/src/errors.ts`
- Create: `packages/upstream/src/client.test.ts`
- Create: `packages/upstream/src/fixtures/*.json`

- [ ] **Step 1: Write contract and authentication tests**

Use a local mock HTTP server to prove login uses `/api/v1/auth/login`, retains the session cookie, sends `X-CSRFToken` on POST, calls the discovered supplier portal paths, and redacts sensitive response data from errors.

- [ ] **Step 2: Write renewal and incompatible-response tests**

Verify one automatic relogin after `401` or recognized session-expiry `403`, no infinite retry, a typed `CaptchaRequiredError`, and a typed `UpstreamContractError` for invalid response shapes.

- [ ] **Step 3: Run tests and verify failure**

Run: `pnpm --filter @keyhub/upstream test`
Expected: FAIL because the adapter is missing.

- [ ] **Step 4: Implement the adapter**

Use a cookie jar and a bounded HTTP client timeout. Implement `login`, `getChannels`, `submitKeys`, `getItems`, `getBatchSummary`, and `getBatchNotes`. Validate responses with schemas and return stable domain objects.

- [ ] **Step 5: Pass tests and commit**

Run: `pnpm --filter @keyhub/upstream test`
Expected: all adapter contract, renewal, timeout, and redaction tests pass.

```bash
git add packages/upstream
git commit -m "feat: add supplier portal adapter"
```

### Task 7: Submission and Synchronization Worker

**Files:**
- Create: `apps/worker/src/index.ts`
- Create: `apps/worker/src/processors/submit-key.ts`
- Create: `apps/worker/src/processors/sync-keys.ts`
- Create: `apps/worker/src/processors/connect-upstream.ts`
- Create: `apps/worker/src/processors/*.test.ts`

- [ ] **Step 1: Write submission idempotency tests**

Verify a pending record becomes `submitted`, ambiguous submission checks upstream before retrying, the same job can run twice without duplicate submission, and retryable errors use at most three attempts.

- [ ] **Step 2: Write synchronization tests**

Verify mapped records update usage and sample fields, unmapped upstream records are ignored, only requested owner records update during manual refresh, and incompatible responses mark the connection unhealthy without overwriting last valid data.

- [ ] **Step 3: Run worker tests and verify failure**

Run: `pnpm --filter @keyhub/worker test`
Expected: FAIL because worker processors are missing.

- [ ] **Step 4: Implement processors and scheduler**

Create BullMQ workers with stable job IDs, per-record locks, sanitized `JobRun` records, exponential backoff, and a repeatable five-minute synchronization job.

- [ ] **Step 5: Pass worker tests and commit**

Run: `pnpm --filter @keyhub/worker test`
Expected: processor and scheduler tests pass.

```bash
git add apps/worker
git commit -m "feat: process Key submissions and usage sync"
```

### Task 8: Administrator Operations and Health APIs

**Files:**
- Create: `apps/api/src/routes/admin-keys.ts`
- Create: `apps/api/src/routes/admin-upstream.ts`
- Create: `apps/api/src/routes/health.ts`
- Create: `apps/api/src/routes/admin-operations.test.ts`

- [ ] **Step 1: Write failing operation tests**

Verify administrators can list all masked records, retry one failed record, trigger sync, read connection status, and update encrypted upstream credentials. Verify ordinary users receive `403`, and no administrator response exposes a full Key.

- [ ] **Step 2: Write health tests**

Verify liveness is process-only, readiness checks PostgreSQL and Redis, and upstream health is reported separately without taking the API out of readiness.

- [ ] **Step 3: Implement routes and pass tests**

Run: `pnpm --filter @keyhub/api test -- admin-operations.test.ts`
Expected: all administrator and health tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes
git commit -m "feat: add administrator operations and health checks"
```

### Task 9: User Web Application

**Files:**
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/pages/LoginPage.tsx`
- Create: `apps/web/src/pages/KeysPage.tsx`
- Create: `apps/web/src/pages/SubmitPage.tsx`
- Create: `apps/web/src/components/KeyTable.tsx`
- Create: `apps/web/src/components/RevealKeyModal.tsx`
- Create: `apps/web/src/pages/*.test.tsx`

- [ ] **Step 1: Write login and dashboard tests**

Verify login errors, redirect after success, summary rendering, status filtering, loading and empty states, and manual refresh feedback.

- [ ] **Step 2: Write submission and reveal tests**

Verify tabbed single/batch forms, per-row errors, duplicate response handling, clickable masked Key text, clipboard write, and full-Key modal display.

- [ ] **Step 3: Run web tests and verify failure**

Run: `pnpm --filter @keyhub/web test`
Expected: FAIL because pages are missing.

- [ ] **Step 4: Implement the list-first Ant Design interface**

Use a restrained neutral palette, compact sidebar, stable table columns, status tags, responsive drawers on mobile, and icon buttons with tooltips. Do not expose channel selection or password-change controls.

- [ ] **Step 5: Pass web tests and commit**

Run: `pnpm --filter @keyhub/web test`
Expected: all user UI tests pass.

```bash
git add apps/web
git commit -m "feat: build KeyHub user portal"
```

### Task 10: Administrator Web Application

**Files:**
- Create: `apps/web/src/pages/admin/UsersPage.tsx`
- Create: `apps/web/src/pages/admin/KeysPage.tsx`
- Create: `apps/web/src/pages/admin/UpstreamPage.tsx`
- Create: `apps/web/src/pages/admin/OperationsPage.tsx`
- Create: `apps/web/src/pages/admin/*.test.tsx`

- [ ] **Step 1: Write administrator page tests**

Verify create/disable/reset user flows, masked global Key rows, retry confirmation, immediate sync, encrypted credential update form, and blocking upstream alerts.

- [ ] **Step 2: Implement pages and role-aware navigation**

Keep operational actions explicit, show success/error toasts, disable actions while pending, and omit full-Key reveal from administrator tables.

- [ ] **Step 3: Pass web tests and commit**

Run: `pnpm --filter @keyhub/web test`
Expected: user and administrator UI tests pass.

```bash
git add apps/web
git commit -m "feat: build KeyHub administrator console"
```

### Task 11: Docker Deployment and Operational Documentation

**Files:**
- Create: `apps/*/Dockerfile`
- Create: `docker-compose.yml`
- Create: `docker/nginx.conf`
- Create: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Add Compose validation checks**

Run: `docker compose config`
Expected: FAIL until all referenced services, files, variables, volumes, and health checks exist.

- [ ] **Step 2: Add production containers and Compose services**

Use multi-stage Node 22 images and non-root runtime users. Define `web`, `api`, `worker`, `postgres`, `redis`, and optional `nginx` services with health checks and named volumes.

- [ ] **Step 3: Document exact deployment flow**

README commands must cover environment generation, migrations, administrator seed, startup, health checks, logs, database backup, restore requirements for encryption keys, and upstream credential configuration.

- [ ] **Step 4: Build and smoke-test containers**

Run: `docker compose config && docker compose build && docker compose up -d && docker compose ps`
Expected: all services build; PostgreSQL, Redis, API, worker, and web report running or healthy.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile docker-compose.yml docker README.md .env.example apps/*/Dockerfile
git commit -m "chore: add production deployment"
```

### Task 12: End-to-End Verification and Upstream Handoff

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/auth-isolation.spec.ts`
- Create: `tests/e2e/key-workflow.spec.ts`
- Create: `tests/e2e/admin.spec.ts`
- Create: `docs/upstream-contract.md`

- [ ] **Step 1: Write browser tests**

Create two users and prove user A cannot list or reveal user B's record. Verify single and batch submission with a mocked upstream, Key click-to-copy/modal behavior, administrator account operations, retry, and sync.

- [ ] **Step 2: Run E2E tests and verify failures before completing fixtures**

Run: `pnpm test:e2e`
Expected: FAIL until the complete application and deterministic upstream mock are wired together.

- [ ] **Step 3: Complete deterministic test fixtures and pass all checks**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`
Expected: every command exits successfully.

- [ ] **Step 4: Verify the interface visually**

Start the local stack, inspect desktop and mobile screenshots, and confirm there is no overlapping text, blank content, horizontal page overflow, or unstable table layout.

- [ ] **Step 5: Document the live upstream contract**

Record endpoint paths, sanitized request/response field names, authentication renewal behavior, timeout values, and the manual confirmation procedure for the first real test Key. Do not include secrets or real Keys.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests docs/upstream-contract.md
git commit -m "test: verify KeyHub workflows end to end"
```

### Task 13: Final Repository Verification and Push

**Files:**
- Modify only files required by verification failures.

- [ ] **Step 1: Review tracked changes and secret exposure**

Run: `git status --short && git diff --check && git grep -nE 'sk-ant-|csrftoken|sessionid|BEGIN (RSA|OPENSSH) PRIVATE KEY' -- ':!docs/superpowers/*' ':!.env.example'`
Expected: clean formatting and no real secret material.

- [ ] **Step 2: Run the complete verification suite from a clean build**

Run: `pnpm clean && pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e && docker compose config`
Expected: every command exits successfully.

- [ ] **Step 3: Add the authorized remote and push**

```bash
git remote add origin git@github.com:nicktaobo/upload_keys_platform.git
git push -u origin main
```

Expected: GitHub accepts the `main` branch and reports it is tracking `origin/main`.
