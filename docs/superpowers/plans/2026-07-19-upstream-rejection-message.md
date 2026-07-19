# Upstream Rejection Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve a bounded, Key-redacted upstream English rejection message and display it to Key owners and administrators.

**Architecture:** The upstream adapter will correlate each response row and expose one stable rejection message without leaking Key-like values. The Worker will persist that value in existing `KeyRecord.failureMessage` and `JobRun.resultMessage` fields. The shared Key table will render the existing API field for both user and administrator views.

**Tech Stack:** TypeScript, Zod, Prisma, Vitest, React, Ant Design

---

### Task 1: Propagate a safe upstream rejection message

**Files:**
- Modify: `packages/upstream/src/contracts.ts`
- Modify: `packages/upstream/src/client.ts`
- Test: `packages/upstream/src/client.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Extend the partial-failure test to expect the correlated failed row's English text:

```ts
await expect(client.submitKeys("7", [
  { apiKey: "key-one", warrantyHours: 24 },
  { apiKey: "key-two", warrantyHours: 48 },
])).resolves.toEqual({
  success: false,
  itemIds: ["42"],
  failureMessage: "This organization has been disabled.",
});
```

Add a test whose upstream message contains `sk-ant-api03-secret-value` and more than 500 characters; assert the stable message excludes the Key-like value and is at most 500 characters.

- [ ] **Step 2: Run the adapter test and verify RED**

Run:

```bash
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH \
pnpm exec vitest run packages/upstream/src/client.test.ts
```

Expected: FAIL because `UpstreamSubmissionResult` has no `failureMessage`.

- [ ] **Step 3: Implement the stable message**

Add the optional stable field:

```ts
export interface UpstreamSubmissionResult {
  success: boolean;
  itemIds: string[];
  failureMessage?: string;
}
```

In `mapSubmissionResponse`, preserve the first correlated failed-row message after applying a helper that trims whitespace, replaces Key-like substrings matching `/sk-ant-[A-Za-z0-9_-]+/gu` with `[REDACTED_KEY]`, and truncates to 500 characters. Do not include a message for successful responses.

- [ ] **Step 4: Run the adapter test and verify GREEN**

Run the command from Step 2. Expected: all upstream tests pass.

### Task 2: Persist the reason for rejected Keys

**Files:**
- Modify: `apps/worker/src/processors/submit-key.ts`
- Test: `apps/worker/src/processors/submit-key.test.ts`

- [ ] **Step 1: Write failing Worker tests**

Add a rejected submission result and assert both records contain the English reason:

```ts
const submitKeys = vi.fn().mockResolvedValue({
  success: false,
  itemIds: [],
  failureMessage: "This organization has been disabled.",
});
```

Assert `KeyRecord.failureMessage` and `JobRun.resultMessage` equal that value. Add a second assertion for `{ success: false, itemIds: [] }` expecting `Upstream rejected this Key`.

- [ ] **Step 2: Run the Worker test and verify RED**

Run:

```bash
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH \
DATABASE_URL=postgresql://keyhub:keyhub_test@127.0.0.1:55432/keyhub \
pnpm exec vitest run apps/worker/src/processors/submit-key.test.ts
```

Expected: FAIL because the Worker persists the fixed Chinese message.

- [ ] **Step 3: Persist the stable reason**

Use one fallback value for both transactions:

```ts
const rejectionMessage = result.failureMessage ?? "Upstream rejected this Key";
```

Store `rejectionMessage` in `KeyRecord.failureMessage` and `JobRun.resultMessage` while retaining `UPSTREAM_REJECTED` and `TEST_FAILED`.

- [ ] **Step 4: Run the Worker test and verify GREEN**

Run the command from Step 2. Expected: all submit processor tests pass.

### Task 3: Show failure details to users and administrators

**Files:**
- Modify: `apps/web/src/components/KeyTable.tsx`
- Modify: `apps/web/src/app/App.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Add `failureMessage: "This organization has been disabled."` to a normal user's failed Key fixture and assert the text is visible. Keep the existing administrator fixture assertion and verify the same column remains visible there.

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```bash
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH \
pnpm exec vitest run apps/web/src/app/App.test.tsx
```

Expected: FAIL because the `Failure` column is administrator-only.

- [ ] **Step 3: Render the shared Failure column**

Move the existing column out of the administrator conditional:

```tsx
{
  title: "Failure",
  dataIndex: "failureMessage",
  width: 260,
  render: (value: string | null) => value ?? "—",
}
```

Increase the non-admin horizontal scroll width so the added column does not compress existing columns.

- [ ] **Step 4: Run the UI test and verify GREEN**

Run the command from Step 2. Expected: all web application tests pass.

### Task 4: Verify and deliver

**Files:**
- Modify: `docs/upstream-contract.md`

- [ ] **Step 1: Document rejection-message propagation**

State that valid failed rows preserve bounded English `message` text after Key-like redaction and that both user and administrator lists display the stored reason.

- [ ] **Step 2: Run full verification**

Run the full test suite against disposable PostgreSQL and Redis, then:

```bash
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH pnpm lint
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH pnpm typecheck
PATH=/Users/tim/.nvm/versions/node/v22.14.0/bin:$PATH pnpm build
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 3: Commit and push**

```bash
git add packages/upstream apps/worker apps/web docs/upstream-contract.md
git commit -m "feat: show upstream rejection reasons"
git push origin main
```
