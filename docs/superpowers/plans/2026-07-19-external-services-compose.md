# External Services Compose Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone KeyHub Compose deployment that uses operator-provided PostgreSQL and Redis URLs without provisioning either service.

**Architecture:** A new Compose file reuses the existing API, Worker, and Web Dockerfiles but defines only `migrate`, `api`, `worker`, and `web`. A separate environment example documents the external connection contract, and Compose interpolation enforces all required URLs and secrets before startup.

**Tech Stack:** Docker Compose, YAML, PostgreSQL URL, Redis URL, Markdown

---

## File Map

- Create `docker-compose.external.yml`: standalone four-service production deployment.
- Create `.env.external.example`: non-secret external-service configuration template.
- Modify `.gitignore`: allow the external example while continuing to ignore real environment files.
- Modify `README.md`: external-service deployment and validation instructions.

### Task 1: Standalone External-Service Compose

**Files:**
- Create: `docker-compose.external.yml`
- Create: `.env.external.example`
- Modify: `.gitignore`

- [ ] **Step 1: Verify the deployment does not exist**

Run:

```bash
test -f docker-compose.external.yml
```

Expected: FAIL with exit code 1 because the standalone deployment has not been created.

- [ ] **Step 2: Create the external environment example**

Add the exception below immediately after `!.env.example` in `.gitignore`:

```gitignore
!.env.external.example
```

Create `.env.external.example` with only placeholders and deployment settings:

```dotenv
DATABASE_URL=postgresql://keyhub:replace-with-password@database.example.internal:5432/keyhub
REDIS_URL=redis://:replace-with-password@redis.example.internal:6379/0
SESSION_SECRET=replace-with-at-least-32-random-characters
ENCRYPTION_KEY_BASE64=replace-with-32-random-bytes-in-base64
HMAC_KEY_BASE64=replace-with-a-different-32-random-bytes-in-base64
ADMIN_USERNAME=admin
ADMIN_PASSWORD=replace-with-at-least-12-characters
UPSTREAM_BASE_URL=https://lingshu.101aix.net
WEB_ORIGIN=https://keyhub.example.com
WEB_PORT=8080
```

- [ ] **Step 3: Create the standalone Compose file**

Create `docker-compose.external.yml` with a shared application environment:

```yaml
services:
  migrate:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    command:
      - /bin/sh
      - -c
      - pnpm --filter @keyhub/database prisma:migrate && pnpm --filter @keyhub/database seed
    environment: &app_environment
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL:?DATABASE_URL is required}
      REDIS_URL: ${REDIS_URL:?REDIS_URL is required}
      SESSION_SECRET: ${SESSION_SECRET:?SESSION_SECRET is required}
      ENCRYPTION_KEY_BASE64: ${ENCRYPTION_KEY_BASE64:?ENCRYPTION_KEY_BASE64 is required}
      HMAC_KEY_BASE64: ${HMAC_KEY_BASE64:?HMAC_KEY_BASE64 is required}
      ADMIN_USERNAME: ${ADMIN_USERNAME:-admin}
      ADMIN_PASSWORD: ${ADMIN_PASSWORD:?ADMIN_PASSWORD is required}
      UPSTREAM_BASE_URL: ${UPSTREAM_BASE_URL:-https://lingshu.101aix.net}
      WEB_ORIGIN: ${WEB_ORIGIN:-http://localhost:8080}
      API_PORT: 3000
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    environment: *app_environment
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:3000/health/live"]
      interval: 10s
      timeout: 3s
      retries: 10
  worker:
    build:
      context: .
      dockerfile: apps/worker/Dockerfile
    environment: *app_environment
    depends_on:
      migrate:
        condition: service_completed_successfully
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "kill -0 1"]
      interval: 15s
      timeout: 3s
      retries: 5
  web:
    build:
      context: .
      dockerfile: apps/web/Dockerfile
    ports:
      - "${WEB_PORT:-8080}:8080"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8080/"]
      interval: 10s
      timeout: 3s
      retries: 10
```

- [ ] **Step 4: Verify the resolved service contract**

Run:

```bash
docker compose --env-file .env.external.example -f docker-compose.external.yml config --services
```

Expected output, one service per line:

```text
migrate
api
worker
web
```

Run:

```bash
docker compose --env-file .env.external.example -f docker-compose.external.yml config --volumes
```

Expected: no output.

- [ ] **Step 5: Verify required configuration fails closed**

Run in an empty environment:

```bash
env -i PATH="$PATH" docker compose --env-file /dev/null -f docker-compose.external.yml config
```

Expected: FAIL and report `DATABASE_URL is required` before any container starts.

- [ ] **Step 6: Commit the deployment files**

```bash
git add docker-compose.external.yml .env.external.example .gitignore
git commit -m "feat: add external services Compose deployment"
```

### Task 2: Operations Documentation And Regression Validation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add external-service deployment instructions**

Document these exact commands under a new `使用现有 PostgreSQL 和 Redis` section:

```bash
cp .env.external.example .env.external
docker compose --env-file .env.external -f docker-compose.external.yml config
docker compose --env-file .env.external -f docker-compose.external.yml up -d --build
docker compose --env-file .env.external -f docker-compose.external.yml ps
curl -fsS http://localhost:8080/health/ready
```

Explain that the URLs must be reachable from containers and that `localhost` inside a container is not the Docker host.

- [ ] **Step 2: Verify both deployment variants**

Run:

```bash
docker compose --env-file .env.external.example -f docker-compose.external.yml config >/dev/null
SESSION_SECRET=0123456789abcdef0123456789abcdef \
ENCRYPTION_KEY_BASE64=AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM= \
HMAC_KEY_BASE64=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc= \
ADMIN_PASSWORD=administrator-password \
docker compose -f docker-compose.yml config >/dev/null
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Verify repository quality gates**

Run:

```bash
pnpm lint
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain external services deployment"
```

### Task 3: Final Verification And Push

**Files:**
- Verify only

- [ ] **Step 1: Confirm no unexpected services or secrets**

Run:

```bash
docker compose --env-file .env.external.example -f docker-compose.external.yml config --services
git grep -nE 'postgres|redis' -- docker-compose.external.yml
git diff --check
git status --short
```

Expected: only the four application services are listed; PostgreSQL and Redis appear only in required URL variable names/values, not as Compose services; the worktree is clean.

- [ ] **Step 2: Push main**

```bash
git push origin main
```

Expected: the remote `main` branch advances to the local verified commit.
