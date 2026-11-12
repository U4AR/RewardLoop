# RewardLoop shopping agent: test report

> **12 November release:** See [the current release record](RELEASE_2026-11-12.md) and [private Render deployment](PRIVATE_DEPLOYMENT.md). The final v2 demo is https://youtu.be/HjQBsC4a5kI. The current flow uses hosted AI, restricted delivery autofill, and verified PayPal Sandbox payment; no retailer order is placed. Earlier prototype/testing notes below are historical where they differ.

**Date:** 11–12 November 2026 (IST) · **Build:** local source on the owner's PC, `npm run dev:workspace` at http://localhost:3001 · **Providers:** Channel3 (live), Kernel (live), Vertex AI `gemini-3.8-flash` in project `gen-lang-client-0907473631` via the local gcloud account in `.env.local` · **Mode:** dry run only. No real card was charged and no real order was placed.

## Result summary

| Check | Result |
| --- | --- |
| Automated tests (`SHOPPING_DB_TEST_URL=… npm test`) | **172 passed**, 27 files (was 137 before this work), including 11 PostgreSQL state-machine tests |
| Typecheck (`tsc --noEmit`) | Pass |
| Production build (`npm run build`) | Pass |
| Live browser tests (below) | Pass, with 3 bugs found and fixed during testing |
| Live retailer order | **Not attempted.** Live mode is off (`RETAILER_LIVE_ORDERS` unset); no retailer reached a reviewable checkout without the person's sign-in or typed details |

## Fixed first: `Cannot read properties of undefined (reading 'totalDays')`

The workspace response is now normalized before render (`src/components/workspace-normalize.ts`): missing `plans`/`checkins` default to empty, and a missing `stats.totalDays` is derived from distinct accepted days. A response without a user is rejected rather than rendered. Covered by 2 unit tests.

## Live tests in the browser (real providers)

| # | Scenario | Observed |
| --- | --- | --- |
| 1 | Channel3 search "watercolor paint set" | Real offers from Hobby Lobby, Target, Michaels, Five Below |
| 2 | Hosted reviewer, reject path | Vague note → not accepted, with specific missing items |
| 3 | Hosted reviewer, accept path | Detailed note → accepted by `gemini-3.8-flash` (1/1 days) |
| 4 | Private destination | Saved encrypted; shown only as `Springfield, OR •••03 (US)` · Pays with PayPal (fictional test address) |
| 5 | Private Kernel session (Live View) on the user's persistent profile | Opened at hobbylobby.com; the retailer showed an hCaptcha (Imperva). Closed without saving |
| 6 | Dry run at hobbylobby.com | Opened the saved offer → **Waiting for you** (CAPTCHA). Stop → "Cancelled. Nothing was purchased" |
| 7 | Cap below the item price ($20 for $24.95) | 400 `CAP_TOO_LOW` |
| 8 | Live-mode approval | 409 `LIVE_ORDERS_DISABLED` |
| 9 | Dry run at firemaplegear.com (Orca dripper, $24.95, cap $45) | Add to cart → Check out → **Stopped safely**: the retailer's checkout said the item was out of stock. Nothing purchased |
| 10 | Goal not earned | 409 `GOAL_INCOMPLETE` |
| 11 | Dry run at miir.com (New Standard Pour-over Kettle, $40, cap $60) | Deny non-essential cookies → Add to Cart → Proceed to checkout → **Waiting for you**: "Checkout requires user sign-in or typing personal contact and shipping address details." Stop → cancelled; second cancel 409; resume after cancel 409 |
| 12 | Duplicate starts: 3 concurrent requests (2 with the same idempotency key) plus a replay | One attempt id returned for all four |
| 13 | Revoke while the agent is running | Run stopped at its next checkpoint → cancelled with 0 steps; a new start → 409 `NO_APPROVAL` |
| 14 | Changed address after approval | UI warning shown (`destinationChanged`); start → 409 `DESTINATION_CHANGED`; restoring the address clears it |
| 15 | Second account against the first account's reward | shopping state / approve / start → 404 "Reward not found."; reconcile of the first account's run → generic 409 (query scoped to the user; no data returned). First account unchanged afterwards |

## Covered by automated tests (not reproducible live without a real order)

- **Changed item, variant, extra items, quantity, merchant, currency, payment method, ship-to:** checkout validation blocks each (`shopping-policy.test.ts`).
- **All-in total over the cap; unreadable shipping, tax or total:** blocked, fails closed.
- **Changed price or availability between approval and run:** `OFFER_CHANGED` / `OVER_CAP` (PostgreSQL test).
- **Live purchase:** a verified receipt marks `purchased` once and consumes the approval; a second purchase is rejected by a unique index.
- **Unknown outcome:** an unverified receipt, or a failure after payment submission, becomes `unknown`. It is never retried and is resolved only by the person ("no order" / "order found").
- **Interrupted run (stale lease):** closed safely if payment was not submitted; `unknown` if it was.
- **Agent guard:** refuses Place order / Buy now, account, address, payment, subscription and consent-acceptance controls; hands off at sign-in and CAPTCHA; stops when the browser leaves the merchant.

## Bugs found by live testing and fixed

1. **Hosted review failed after about an hour of uptime** (503 "review unavailable"). A new secret-free diagnostic showed Google returning HTTP 401: the app cached the gcloud token for 45 minutes, but `gcloud auth print-access-token` can return a token with only minutes left. Fix: 5-minute cache, and on 401 the token is dropped and the request retried once (review and agent planner). Confirmed live: accepted in 4.9 s. 2 new tests.
2. **The agent accepted a cookie banner** ("Accept"). Accepting consent is the user's decision. Fix: code refuses Accept / Allow / Agree consent controls, and the planner is told to decline or close. Confirmed live: it chose "Deny Non-Essential".
3. **"Add to Cart" was missing from the agent's element list** on a page with a large navigation menu (only the first 90 elements were sent). Fix: purchase, variant and consent-decline controls are ranked first (110 elements). Confirmed live at miir.com.

Also corrected: the create-reward consent text, budget help text and the About page, which still said purchases are always completed by the user at the retailer.

## Known limits

- No retailer reached a reviewable checkout in dry run: Hobby Lobby required a CAPTCHA, Fire Maple Gear's checkout said out of stock, and MiiR required typed contact details. A person who signs in at the retailer in their private Kernel profile with a saved address would let the agent continue; that path was not exercised (no real retailer account was used).
- The agent cannot type by design, so guest checkouts always hand off.
- Live ordering and receipt verification were not tested against a real retailer.
- Deployment still needs a durable database (the free Render database expires 23 November 2026) and a production Google runtime identity instead of the local gcloud login.
