# Critical transfer fixes

Scope: explicit confirmation and safe transfer retries. The external simulator is unchanged.

## Confirmation

Both manual transfers and the agent's `transfer_money` tool create a proposal. No transfer request is sent until the account holder confirms its displayed source, destination, amount and description through `/api/approvals/:id/confirm`.

Proposals expire after ten minutes. The server verifies the holder, intent and exact payload. Repeating the same intent reuses its active proposal; changing its payload returns a conflict. Confirmation consumption and allocation of the bank reference are committed together in SQLite, before sending money. Repeating a consumed confirmation can recover only its original payment; its original confirmation remains valid for that recovery even after the proposal's expiry date.

## Idempotency and uncertainty

Every confirmed intent has one durable bank reference. The application checks this reference before dispatch and after a transport/server error. A retry always uses the same reference, including concurrent confirmations. Two separately confirmed intents with identical details keep different references and remain legitimate separate payments.

If lookup is unavailable or the bounded retry cannot verify completion, the result is `pending`, rather than a claim of failure. The dashboard exposes these transfers with their original proposal and a **Check / retry original transfer** button. This first queries the bank and, only if it returns 404, may retry the already authorized payment using its original reference. Completed intents never dispatch another payment, even if a later status lookup is unavailable.

The browser preserves the intent ID when retrying an unchanged manual proposal after a request error. Agent instructions distinguish proposals, confirmation and pending outcomes. Missing/malformed bank responses are treated as transport uncertainty.

## Verification

Use Node.js 24 or newer and install dependencies with `npm ci`.

- `npm test`: existing invariants plus transfer integration tests, using an isolated temporary bank HTTP server and temporary databases. No OpenAI key is needed. Test-only administrative snapshots verify real bank effects; application code uses only the supported bank API.
- `npm run typecheck`
- `npm run build`

Integration coverage includes proposal-only actions, repeated intents and confirmations, concurrent confirmations, expired/foreign/altered proposals, invalid amounts and ownership, insufficient funds, identical distinct payments, lost/slow/intermittent responses, rejection before commit, unavailable verification, recovery after reopening the app database and malformed responses after commit.

## Manual demo

1. Start the application and select Lucía. Prepare a small transfer to Bruno using **Review transfer**. Balances must remain unchanged and a proposal must appear.
2. Run `npm run scenario -- lost-response`, then confirm that proposal. The payment should complete once despite the lost response.
3. Run `npm run scenario -- read-unavailable`, prepare and confirm a new payment. The dashboard should show an unverified transfer. Use its original **Check / retry original transfer** button: it should recover the completed payment without a second debit.
4. In chat, ask the agent to prepare a payment. Review and confirm its proposal in the same UI. Merely asking about payment conditions should not execute a payment.

Live chat behavior requires an OpenAI key; automated integration tests exercise the server confirmation boundary without a model request. Document retrieval, operator features and other previously identified improvements remain outside this change.
