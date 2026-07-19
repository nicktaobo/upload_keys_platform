# Public Container Images Design

## Goal

Publish deployable KeyHub API, Worker, and Web images from GitHub Actions so production can update with `docker compose pull` and does not need the source tree or a local image build.

## Registry And Images

Use GitHub Container Registry with three packages:

- `ghcr.io/nicktaobo/keyhub-api`
- `ghcr.io/nicktaobo/keyhub-worker`
- `ghcr.io/nicktaobo/keyhub-web`

The migration service uses the API image because the API Dockerfile already contains the database workspace and Prisma migration commands.

Each successful publication produces:

- `latest` for the current `main` commit;
- `sha-<commit>` as an immutable deployment and rollback reference.

Images target `linux/amd64` and `linux/arm64`.

## Workflow

Add one GitHub Actions workflow that runs on pushes to `main` and through `workflow_dispatch`. It grants `contents: read` and `packages: write`, logs in to GHCR with `GITHUB_TOKEN`, and builds the three existing Dockerfiles with Buildx. Matrix jobs may run independently, and GitHub Actions cache is scoped per image.

The workflow must not contain application secrets, upstream credentials, database URLs, or registry personal access tokens.

## Compose Integration

Keep `docker-compose.external.yml` as the shared external-services deployment file. Add an `image` to `migrate`, `api`, `worker`, and `web` while retaining each existing `build` block for local source builds.

Image environment variables and defaults:

```dotenv
KEYHUB_API_IMAGE=ghcr.io/nicktaobo/keyhub-api:latest
KEYHUB_WORKER_IMAGE=ghcr.io/nicktaobo/keyhub-worker:latest
KEYHUB_WEB_IMAGE=ghcr.io/nicktaobo/keyhub-web:latest
```

Both `migrate` and `api` use `KEYHUB_API_IMAGE`.

Local development continues to use `docker compose ... up -d --build`. Production uses:

```bash
docker compose --env-file .env.external -f docker-compose.external.yml pull
docker compose --env-file .env.external -f docker-compose.external.yml up -d --no-build
```

Production may pin any image variable to a matching `sha-<commit>` tag for deterministic rollback.

## Public Visibility

GHCR container packages are not made public by Docker metadata alone. After the first workflow run creates each package, the repository owner must open each package's settings and change visibility to `Public`. Once public, production servers can pull without `docker login ghcr.io`.

## Verification

- Validate workflow YAML syntax and required permissions, triggers, matrix entries, tags, platforms, and Dockerfiles.
- Render External Compose with default image names and with pinned SHA image overrides.
- Build all three Dockerfiles locally.
- Run repository lint, typecheck, tests, and build.
- Confirm no secrets or local `.env.external` values are added to Git.
