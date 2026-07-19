# KeyHub External Services Compose Design

## Goal

Provide a second Docker Compose deployment for servers that already operate PostgreSQL and Redis. The new deployment must run only KeyHub application services and connect to those external dependencies through complete connection URLs.

## Deployment File

Add `docker-compose.external.yml` as a standalone Compose file. It defines exactly four services:

- `migrate`: applies Prisma migrations and creates or updates the bootstrap administrator.
- `api`: serves the KeyHub HTTP API.
- `worker`: processes submission and synchronization queues.
- `web`: serves the portal and proxies API requests.

The file does not define `postgres` or `redis` services and does not declare database or Redis volumes.

## Configuration

Add `.env.external.example` with non-secret placeholders. The deployment requires:

- `DATABASE_URL`: complete PostgreSQL URL reachable from inside containers.
- `REDIS_URL`: complete Redis URL reachable from inside containers.
- `SESSION_SECRET`: at least 32 random characters.
- `ENCRYPTION_KEY_BASE64`: 32 random bytes encoded as Base64.
- `HMAC_KEY_BASE64`: a different 32 random bytes encoded as Base64.
- `ADMIN_PASSWORD`: bootstrap administrator password of at least 12 characters.

Optional values retain the current defaults for `ADMIN_USERNAME`, `UPSTREAM_BASE_URL`, `WEB_ORIGIN`, and `WEB_PORT`.

Compose interpolation must reject missing required URLs and secrets before containers start. Credentials remain in the local `.env` file and are never committed.

## Startup And Dependencies

`migrate` starts first and connects directly to external PostgreSQL. `api` and `worker` wait for `migrate` to finish successfully. `web` waits for the API health check.

There is no Compose `depends_on` relationship for PostgreSQL or Redis because those services are outside this deployment. Connection failures are surfaced by migration failure, API readiness, or Worker task failures.

## Documentation

README instructions will show how to:

1. Copy `.env.external.example` to a deployment-specific env file.
2. Set URLs that are reachable from containers, not merely from the Docker host.
3. Validate the resolved configuration.
4. Start and inspect the four-service stack.

The documentation will note that `localhost` inside a container refers to that container. A database or Redis process on the Docker host therefore needs a host-reachable address such as `host.docker.internal` where supported, a host gateway, or the server's network address.

## Verification

The implementation is accepted when:

- `docker compose -f docker-compose.external.yml config --services` lists only `migrate`, `api`, `worker`, and `web`.
- The resolved configuration contains the supplied external `DATABASE_URL` and `REDIS_URL`.
- Missing required URLs or security values makes Compose configuration fail.
- The existing self-contained `docker-compose.yml` remains valid and unchanged in behavior.
- README commands and `.env.external.example` contain no real credentials.

## Scope

This change does not provision, configure, back up, monitor, or alter the external PostgreSQL and Redis services. TLS, authentication, firewall rules, database creation, and Redis persistence remain the operator's responsibility.
