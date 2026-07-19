# Upstream Rejection Message Design

## Goal

Show the upstream supplier portal's English per-row rejection message to both the Key owner and administrators when a Key submission is rejected.

## Data Flow

1. `SupplierPortalClient` validates that every submission result matches a requested `row_id`.
2. For a valid `failed` row, the adapter returns its optional upstream `message` with the stable submission result.
3. The Worker stores that message in both `KeyRecord.failureMessage` and the submission `JobRun.resultMessage`.
4. User and administrator Key lists receive the existing `failureMessage` API field and render it in a `Failure` column.

## Message Handling

- Preserve the upstream English wording; do not translate or classify it.
- Redact Key-like values before persistence or display so a supplier response cannot expose a full Key to administrators or logs.
- Trim surrounding whitespace and enforce a bounded stored length.
- If the upstream row has no usable message, use `Upstream rejected this Key`.
- Contract mismatches, network errors, and login failures keep their existing retry and generic error behavior. They are not treated as explicit upstream rejection messages.

## Existing Records

Existing failed records retain their current generic message. A retry that receives a valid upstream row rejection replaces it with the upstream English reason.

## Tests

- Upstream adapter correlates the row and returns its English rejection message.
- Upstream adapter redacts Key-like content and bounds the returned message.
- Worker persists the returned reason to the Key and JobRun, with a generic fallback.
- User and administrator Key tables both render the `Failure` column and its message.
- Existing success, partial failure, retry, and contract mismatch tests continue to pass.
