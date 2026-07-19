# Public Container Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish public-ready multi-architecture API, Worker, and Web images to GHCR and let production update with Docker Compose pull commands.

**Architecture:** One matrix GitHub Actions job builds the three existing Dockerfiles and publishes `latest` plus immutable `sha-*` tags. External Compose retains local `build` definitions but gains configurable image references, so production can pull and start with `--no-build` while local development remains unchanged.

**Tech Stack:** GitHub Actions, Docker Buildx, GHCR, Docker Compose

---

### Task 1: Add the GHCR publication workflow

**Files:**
- Create: `.github/workflows/publish-images.yml`

- [ ] **Step 1: Create the workflow**

Define `push` for `main` and `workflow_dispatch`, with:

```yaml
permissions:
  contents: read
  packages: write
```

Use a matrix containing these exact pairs:

```yaml
include:
  - image: keyhub-api
    dockerfile: apps/api/Dockerfile
  - image: keyhub-worker
    dockerfile: apps/worker/Dockerfile
  - image: keyhub-web
    dockerfile: apps/web/Dockerfile
```

Use `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action`, `docker/metadata-action`, and `docker/build-push-action`. Publish to `ghcr.io/${{ github.repository_owner }}/${{ matrix.image }}` for `linux/amd64,linux/arm64`. Produce `latest` only on the default branch and `sha-` tags on every run. Scope GHA cache by matrix image.

- [ ] **Step 2: Validate the workflow**

Run:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest
```

Expected: exit 0 with no diagnostics.

### Task 2: Make External Compose pullable

**Files:**
- Modify: `docker-compose.external.yml`
- Modify: `.env.external.example`

- [ ] **Step 1: Add configurable images**

Add these exact references while retaining existing `build` blocks:

```yaml
migrate:
  image: ${KEYHUB_API_IMAGE:-ghcr.io/nicktaobo/keyhub-api:latest}
api:
  image: ${KEYHUB_API_IMAGE:-ghcr.io/nicktaobo/keyhub-api:latest}
worker:
  image: ${KEYHUB_WORKER_IMAGE:-ghcr.io/nicktaobo/keyhub-worker:latest}
web:
  image: ${KEYHUB_WEB_IMAGE:-ghcr.io/nicktaobo/keyhub-web:latest}
```

Add the three default image variables to `.env.external.example`.

- [ ] **Step 2: Validate default and immutable image rendering**

Run default validation without printing expanded secrets:

```bash
docker compose --env-file .env.external -f docker-compose.external.yml config --quiet
```

Render only image names with pinned overrides:

```bash
KEYHUB_API_IMAGE=ghcr.io/nicktaobo/keyhub-api:sha-test \
KEYHUB_WORKER_IMAGE=ghcr.io/nicktaobo/keyhub-worker:sha-test \
KEYHUB_WEB_IMAGE=ghcr.io/nicktaobo/keyhub-web:sha-test \
docker compose --env-file .env.external -f docker-compose.external.yml config --images
```

Expected: two API image lines and one line each for Worker and Web, all using `sha-test`.

### Task 3: Document public deployment

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add production pull instructions**

Document:

```bash
docker compose --env-file .env.external -f docker-compose.external.yml pull
docker compose --env-file .env.external -f docker-compose.external.yml up -d --no-build
docker compose --env-file .env.external -f docker-compose.external.yml ps
```

Explain that the first workflow run creates three GHCR packages and the owner must set each package visibility to `Public`. Explain `latest` tracking and pinning all three variables to the same `sha-*` commit for rollback.

- [ ] **Step 2: Verify documentation and configuration consistency**

Run:

```bash
rg -n "keyhub-(api|worker|web)|--no-build|Package.*Public|sha-" \
  README.md .env.external.example docker-compose.external.yml \
  .github/workflows/publish-images.yml
git diff --check
```

Expected: all image names and deployment commands are present; diff check exits 0.

### Task 4: Build and deliver

**Files:**
- Verify: `apps/api/Dockerfile`
- Verify: `apps/worker/Dockerfile`
- Verify: `apps/web/Dockerfile`

- [ ] **Step 1: Build all runtime images locally**

Run:

```bash
docker build -f apps/api/Dockerfile -t keyhub-api:verify .
docker build -f apps/worker/Dockerfile -t keyhub-worker:verify .
docker build -f apps/web/Dockerfile -t keyhub-web:verify .
```

Expected: all three builds exit 0.

- [ ] **Step 2: Run repository verification**

Run the test suite against disposable PostgreSQL and Redis, followed by:

```bash
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH pnpm lint
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH pnpm typecheck
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit and push**

```bash
git add .github/workflows/publish-images.yml docker-compose.external.yml \
  .env.external.example README.md
git commit -m "ci: publish public container images"
git push origin main
```
