# KeyHub Design

Date: 2026-07-19
Status: Approved design pending written-spec review

## 1. Purpose

KeyHub is a small multi-user supplier Key portal. Administrators create local user accounts. Users submit Claude official API Keys to KeyHub, which relays them through one authorized supplier account on the upstream Baiyi Lingshu operations platform. KeyHub then synchronizes each submitted Key's status and consumption data back to its owner.

The first release targets fewer than 50 users and fewer than 5,000 Keys. It runs on a Linux server with Docker Compose.

## 2. Confirmed Product Scope

### 2.1 User accounts

- Administrators create usernames and passwords.
- Users cannot register, change passwords, or recover passwords.
- Administrators can reset passwords, disable accounts, and create new accounts.
- Resetting or disabling an account invalidates its existing sessions.
- Passwords are stored with Argon2id hashes.

### 2.2 Supported upstream channel

- The first release supports only the current `ModelBoxs-Claude-按量（Claude 官方）` channel.
- Users do not select an upstream channel.
- Every local user is relayed through the same authorized upstream supplier account.

### 2.3 Key submission

- A user can submit one Key through a form.
- A user can paste multiple rows in the format `Key, warranty hours`.
- Each row is validated independently for required values, format, warranty range, and duplicates.
- A keyed HMAC fingerprint provides global deduplication without using the encrypted value as an index.
- The first user to submit a Key owns the local record. Later duplicate submissions receive only a generic duplicate error and reveal no owner, status, or usage information.

### 2.4 Key display and retention

- Full Keys are permanently stored using application-level AES-256-GCM encryption with a unique random IV per record.
- The encryption key is supplied through the deployment environment and is never stored in PostgreSQL or committed to Git.
- Normal list endpoints return only a masked value.
- A user can click the masked Key text. KeyHub verifies ownership, returns the decrypted Key, copies it to the clipboard, and opens a modal showing the full value.
- The first release has no separate reveal button, password confirmation, or reveal timeout.
- Ordinary users can reveal only their own Keys.
- The administrator's global Key list remains masked and does not provide a reveal action.
- Full Keys, encrypted values, upstream credentials, cookies, and CSRF tokens must never be included in logs or error messages.

### 2.5 Status and usage

- KeyHub synchronizes status and usage every five minutes.
- Users can request a manually rate-limited refresh for their own records.
- Displayed fields include local submission state, upstream test result, access status, consumption in USD, consumption site count, upstream sample time, and submission time.
- Summary values include submitted Key count, accumulated consumption, healthy Key count, and latest sample time.

### 2.6 Administrator functions

- Manage local users.
- View all masked Key records with owner, state, usage, and failure details.
- View the upstream connection state, last login, and last synchronization.
- Retry an individual failed submission.
- Trigger an immediate synchronization.
- The first release excludes report exports, billing, payout calculations, bulk deletion, and advanced analytics.

## 3. Upstream Integration

### 3.1 Integration method

KeyHub uses a dedicated backend adapter that reproduces the upstream site's normal JSON request flow. The browser never calls the upstream service directly.

The inspected upstream frontend uses an `/api/v1` base path, session-cookie authentication, and a CSRF token on write requests. Relevant endpoints observed in the deployed frontend include:

- `POST /api/v1/auth/login`
- `GET /api/v1/supplier-portal/channels/`
- `GET /api/v1/supplier-portal/channels/{channelId}/items/`
- `POST /api/v1/supplier-portal/channels/{channelId}/items/submit/`
- `GET /api/v1/supplier-portal/channels/{channelId}/batch-summary/`
- `GET /api/v1/supplier-portal/channels/{channelId}/batch-notes/`

These are deployed, undocumented interfaces. The adapter isolates their URL construction, authentication, request schemas, response schemas, error mapping, and masking. Upstream changes must not leak into domain or UI code.

### 3.2 Authentication lifecycle

- The upstream username and password are encrypted at rest.
- The adapter logs in and keeps the resulting session cookie and CSRF token in the server-side connection record.
- When a request indicates an expired session, the adapter logs in again and retries the original request once.
- If login requires a CAPTCHA or the login response no longer matches the contract, automatic submissions and synchronization pause and the administrator dashboard displays a blocking alert.
- KeyHub does not bypass CAPTCHAs.

### 3.3 Matching upstream records

- Successful submissions store the upstream item identifier whenever the response provides one.
- The Key HMAC fingerprint and masked suffix provide a secondary matching signal.
- Synchronization updates only local records with a confirmed upstream mapping.
- Upstream records with no local mapping are ignored and never assigned to a local user.
- When a submission response is ambiguous, the worker checks the upstream list for a matching record before retrying, preventing duplicate submissions.

## 4. Architecture

The implementation uses a TypeScript workspace with the following processes:

- React and Ant Design web application for the user and administrator interfaces.
- Fastify API for authentication, authorization, validation, persistence, and UI-facing endpoints.
- BullMQ worker for submission, retry, login renewal, and five-minute synchronization jobs.
- PostgreSQL for durable application state.
- Redis for sessions, rate limiting, job queues, and distributed job locks.
- A standalone upstream adapter package shared by the API and worker where appropriate.

Docker Compose runs `web`, `api`, `worker`, `postgres`, and `redis`. A reverse proxy terminates HTTPS in the deployment environment.

## 5. Component Boundaries

### 5.1 Web application

The web application renders the operational interface and never receives upstream credentials, cookies, CSRF tokens, ciphertext, or another user's data. It calls only KeyHub API endpoints.

### 5.2 API

The API owns local authentication, role guards, owner-scoped queries, input parsing, password administration, reveal authorization, and job scheduling. Ordinary user endpoints derive the owner ID from the server-side session and never accept an arbitrary owner ID from the client.

### 5.3 Worker

The worker is the only component that submits Keys and performs full upstream synchronization. Jobs are idempotent, use per-record or per-connection locks, and persist an operator-readable result without sensitive values.

### 5.4 Upstream adapter

The adapter exposes domain-oriented operations:

- `login()`
- `getChannels()`
- `submitKeys(channelId, rows)`
- `getItems(channelId, cursor)`
- `getBatchSummary(channelId)`
- `getBatchNotes(channelId)`

It is responsible for the cookie jar, CSRF headers, timeouts, bounded retry behavior, validation of upstream response shapes, and conversion to stable KeyHub types.

## 6. Data Model

### 6.1 User

- `id`
- `username` with a unique constraint
- `password_hash`
- `role`: `admin` or `user`
- `is_active`
- `session_version`
- creation and update timestamps

### 6.2 KeyRecord

- `id`
- `owner_id`
- `encrypted_key`, `encryption_iv`, and `encryption_tag`
- globally unique `key_fingerprint`
- `masked_key` and non-sensitive suffix
- `warranty_hours`
- `upstream_channel_id`
- nullable `upstream_item_id`
- local status
- upstream test result and access status
- `usage_usd`
- `usage_site_count`
- `sampled_at`
- `submitted_at`
- sanitized failure code and message
- creation and update timestamps

### 6.3 UpstreamConnection

- encrypted username and password
- encrypted session state and CSRF token
- resolved channel identifier
- connection state
- last login, last success, last failure, and last synchronization timestamps
- sanitized failure details

### 6.4 JobRun

- job type, target record, state, attempt count, start and finish timestamps
- sanitized result or failure details
- no full Key, credentials, cookies, tokens, or ciphertext

## 7. User Interface

### 7.1 Layout

The approved layout is list-first. After login, users see their Key summary and table. A prominent primary action opens the submission workspace. The visual style is a restrained operational dashboard aligned with the target site's information density, without copying its branding.

### 7.2 User pages

- Login
- My Keys dashboard
- Submit Key workspace with `Single` and `Batch paste` tabs

The Key table supports status filtering and pagination. The masked Key text is visibly interactive. Clicking it invokes the owner-scoped reveal endpoint, writes the full value to the clipboard, and opens a modal containing the full value.

### 7.3 Administrator pages

- User management
- Global masked Key list
- Upstream connection status
- Submission and synchronization operations

## 8. State and Error Handling

Local Key states are:

- `pending`
- `submitting`
- `submitted`
- `test_failed`
- `retrying`
- `upstream_error`

Network failures and upstream `5xx` responses use exponential backoff with at most three automatic retries. Authentication and CSRF failures trigger one login renewal and one request retry. Validation and other non-retryable `4xx` responses become sanitized user-visible errors.

An incompatible upstream response pauses the affected automation rather than making assumptions. The administrator sees a clear alert and the worker preserves the last valid local data.

## 9. Security Baseline

Although the first release intentionally keeps Key reveal interaction simple, the following controls are mandatory:

- HTTPS in production.
- Argon2id password hashing.
- HttpOnly, Secure, SameSite session cookies.
- Server-side sessions with immediate invalidation after account disable or password reset.
- Role and owner checks at the query and service layers.
- AES-256-GCM encryption for full Keys and upstream secrets.
- HMAC fingerprints for global duplicate detection.
- CSRF protection on local write endpoints.
- Request size limits, login rate limiting, reveal rate limiting, and submission rate limiting.
- Structured log redaction for sensitive field names and Key-like values.
- Secrets supplied through environment variables or deployment secret files.

## 10. Testing

### 10.1 Unit tests

- Single and batch input parsing
- Masking and HMAC fingerprinting
- Encryption and decryption
- Duplicate handling
- Status and error mapping
- Upstream response validation

### 10.2 API integration tests

- Login and logout
- Account disable and password reset session invalidation
- Owner-scoped list and reveal behavior
- Cross-user access denial
- Administrator role enforcement
- Single and batch submission validation
- Global duplicate rejection without owner disclosure

### 10.3 Worker and adapter tests

- Submission idempotency
- Retry limits and backoff
- Session renewal
- CSRF renewal
- Synchronization mapping
- Ignoring unmapped upstream records
- Redacted logs and failures

Adapter contract fixtures use synthetic or fully redacted responses. No real account, Key, cookie, or token is committed to the repository.

### 10.4 Browser tests

- A user submits one and multiple Keys.
- A user sees only their own records.
- Clicking a masked Key copies and displays the full Key.
- Another user cannot list or reveal that record.
- An administrator creates, disables, and resets a user.
- An administrator retries a failed item and triggers synchronization.

## 11. Deployment and Operations

The repository provides Dockerfiles, Docker Compose configuration, health checks, PostgreSQL migrations, persistent volumes, and an `.env.example` without secrets. Startup fails clearly when encryption and HMAC keys are absent.

The API and worker expose health information for PostgreSQL, Redis, and upstream connection state. Database backups must include encrypted Key data; restoring a backup also requires the matching encryption key.

## 12. Acceptance Criteria

- An administrator can create a local user and assign a password.
- Two local users cannot list, reveal, or infer ownership of each other's Keys.
- Single and batch submissions are relayed through the fixed upstream channel.
- The same Key cannot be assigned to two users.
- Submitted Keys retain an owner-scoped, recoverable encrypted full value.
- Status and usage synchronize every five minutes and through a rate-limited manual refresh.
- Upstream authentication renews automatically when possible and pauses safely on CAPTCHA or incompatible behavior.
- Administrators can manage accounts, inspect masked failures, retry one record, and trigger synchronization.
- Docker Compose starts the complete system on a Linux server.
- Automated tests cover isolation, encryption, deduplication, submission idempotency, retry behavior, and synchronization mapping.

## 13. Explicitly Deferred

- User registration, password changes, and password recovery
- Multiple upstream channels or supplier accounts
- Billing, payouts, exports, and analytics reports
- Bulk deletion
- Administrator reveal of users' full Keys
- Browser-based upstream automation
- Automated CAPTCHA solving
