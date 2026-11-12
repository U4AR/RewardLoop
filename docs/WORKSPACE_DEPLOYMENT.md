# RewardLoop reward workspace

The main app at `/` now uses real Channel3 products, hosted Gemini evidence review, short-lived Kernel retailer checks, and an optional Kernel shopping agent that runs only under an explicit, bounded purchase approval (dry run by default). No local Qwen process, synthetic shop, seed products, or background worker is required for this flow. The former synthetic PayPal demonstration remains separate at `/sandbox`; it is never evidence of a real retailer purchase.

## Run the configured local version

```sh
npm ci
npm run db:migrate
npm run auth:migrate
npm run dev:workspace
```

Open http://localhost:3001. This command uses a separate Next.js build directory so the earlier port-3000 demo can stay open. The ignored local configuration selects `vishnusuresh0521@gmail.com`, project `gen-lang-client-0907473631`, and `gemini-3.8-flash`. It uses the owner's existing gcloud login only for local development. The app-specific `VERTEX_PROJECT_ID` avoids collision with a machine-wide `GOOGLE_CLOUD_PROJECT` setting.

## Connected services

| Service | Role | Configuration |
| --- | --- | --- |
| Vertex AI | Reviews goal criteria and submitted notes | `VERTEX_PROJECT_ID`, `VERTEX_MODEL`, `VERTEX_LOCATION`, Google identity |
| Channel3 | Real products, images, retailer offers, refreshed offer before handoff | `CHANNEL3_API_KEY` |
| Kernel | Reads public retailer metadata in a temporary browser; per-user persistent profiles with Live View for private retailer sign-in; the shopping agent's browser | `KERNEL_API_KEY` |
| Encryption | AES-256-GCM for saved delivery details | `DATA_ENCRYPTION_KEY` (32 bytes, base64url) |
| Live ordering switch | Off unless exactly `enabled`; without it only dry-run approvals are accepted | `RETAILER_LIVE_ORDERS` |
| PostgreSQL | Private rewards, check-ins, reviews, and rate reservations | `DATABASE_URL` |
| Better Auth | Email/password login and secure session | `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ALLOW_LOCAL_SIGNUP` |

Kernel credits pay for browser usage, not Gemini tokens. The existing Channel3 and Kernel keys are configured privately; remaining promotional balances and expiry must be checked in their dashboards. A connected Render email confirms a $50 hackathon offer, but this release does not provision a paid service or redeem a code automatically.

## Deploy on Render

The root `render.yaml` defines one Node web service in Singapore, with migrations before deployment. It uses an existing PostgreSQL database rather than creating another database or worker. The old blueprint is preserved as `render.sandbox.yaml` for the optional legacy sandbox flow.

1. Push the reviewed source and create/sync the `render.yaml` Blueprint. Review the current service quote and workspace credit balance.
2. Set `APP_ORIGIN` and `BETTER_AUTH_URL` to the exact assigned HTTPS origin. Supply the remaining environment secrets privately.
3. Configure Google's runtime identity. On Render, mount a valid workload identity configuration or service-account credential as secret file `google-credentials.json`, using `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-credentials.json`. That identity needs Vertex inference access in Vishnu's project. Do not upload a user's gcloud profile. On Google Cloud Run, attach an appropriate service identity and use ADC without a secret file.
4. Use durable PostgreSQL with backups. The previously documented free Render database expires on **23 November 2026**; check its current retention before public or judging deployment.
5. Run domain/auth migrations during release. Migration 0007 adds workspace tables and indexes while preserving earlier goals, permissions, and payment records.
6. Signup is invite-only by default (`ALLOW_LOCAL_SIGNUP=false`). Existing provisioned users can sign in. Set this to `true` when intentionally opening registration. Provision a deliberate synthetic judge account if needed; never publish its password.
7. Verify `/api/healthz`, login, product search, reward creation, notes review, retailer checking, earned-reward handoff, and a dry-run shopping run (expect a handoff or a safe stop). Verify user isolation. Retailer order submission is always disabled in the shopping flow, even if `RETAILER_LIVE_ORDERS` was set.

The workspace now needs the existing PayPal Sandbox merchant credentials for shopping payments; product search and check-ins work without them. It needs no local model, `MOCK_STORE_ORIGIN`, or worker. The separate legacy sandbox demonstration needs its original merchant configuration, synthetic store, and worker.

## Container deployment

The included `Dockerfile` builds on Node 24 and runs as the non-root `node` user. `.dockerignore` excludes credentials, local models, videos, profiles, and development outputs. It listens on `$PORT` (8080 by default). Run domain/auth migrations as a release job and supply runtime secrets and the exact HTTPS origin. Do not bake `.env.local` into the image.

## Shopping agent

Verified locally on 11 November 2026 against real retailers in dry-run mode; see `docs/SHOPPING_AGENT_TEST_REPORT.md` for the evidence.

1. **Private delivery details.** Saved AES-256-GCM encrypted. The UI and the approval show only a masked label (for example `Springfield, OR •••03 (US)`) plus a fingerprint of the street and postal code.
2. **Private retailer session.** Each user has a server-derived Kernel profile name (`rl-` + hash of the user id). "Open private session" starts a headful, non-stealth browser on that profile with Live View, so the person signs in and saves address and payment at the retailer themselves. RewardLoop never receives the retailer password. Sessions are limited to 12 per user per day.
3. **Purchase approval.** Saving an address is not consent. An approval binds the Channel3 product and variant, merchant, quantity 1, destination fingerprint, payment label, USD, an all-in cap including shipping and tax, a validity window that ends no later than the reward deadline, and the earned-goal requirement. The offer is revalidated when approving; a cap below the item price is refused. One active approval per reward; approving again revokes the previous one. Revoke is available at any time.
4. **Shopping run.** Requires an active, unexpired approval, an earned goal, an unchanged destination, and a current Channel3 offer that is in stock and within the cap. Each start carries an idempotency key; a unique index allows one open run per approval. A run takes a 4-minute database lease; stale leases are swept. Kernel opens the saved offer on the user's profile (without saving profile changes). Gemini chooses one element per step from an indexed list. The browser driver can only navigate, click and select, so it cannot type personal data or passwords. Code refuses order-submission, account, address, payment, subscription and cookie/terms-acceptance controls, and stops if the browser leaves the approved merchant. Sign-in pages, CAPTCHAs and forms that need typed details hand off to the person through Live View ("Waiting for you"); RewardLoop does not solve CAPTCHAs.
5. **Checkout validation.** At the review page, code checks merchant, single item, title and variant, quantity, currency, subtotal, shipping, tax and total within the cap, ship-to (postal code, house number and street word) and payment method. Missing shipping, tax or total fails closed.
6. **Payment (live mode only, off by default).** Requires `RETAILER_LIVE_ORDERS=enabled` and a live approval. Exactly one order-submit control must be present. `payment_submitted_at` is written before the click. A run becomes `purchased` only with a merchant receipt that shows confirmation, an order number, the merchant host and a total within the cap; the approval is then consumed, and a unique index prevents a second purchase. Any other outcome after submission becomes `unknown`: it is never retried and must be reconciled by the person ("no order was placed" / "I found the order"). Live ordering was not exercised against a real retailer; it is covered by database tests with a simulated retailer.

Not supported in this release: typing contact or address details into guest checkouts, solving CAPTCHAs, quantities above 1, currencies other than USD, and verified live orders.

## Product and payment behavior

Each reward saves the Channel3 product/variant ID, merchant, budget, goal criteria, timezone, deadline, and reviewer model. Model output is schema-checked; uncertain, incomplete, or truncated output does not count as progress. One accepted check-in per reward per calendar day counts. Reviews are bounded and reserved before provider calls.

For the read-only retailer check, Kernel visits the saved offer, permits the known Channel3 affiliate redirect, and requires the final page to match the selected merchant. Multiple variants, blocked pages, and absent USD metadata produce a limited check. This check never signs in, changes a cart or pays; cart actions happen only in an approved shopping run (above).

For people who prefer to buy it themselves, earned rewards refresh the saved product's current offer for the same merchant. Out-of-stock or over-budget item prices block handoff, as does a contradictory recent Kernel observation. The user confirms the variant, shipping, tax, delivery address, and final total at the retailer. PayPal can be selected if that retailer supports it. Opening a retailer is not a paid order or a guaranteed all-in quote.

## Validation

```sh
SHOPPING_DB_TEST_URL=$DATABASE_URL npm test   # includes the PostgreSQL purchase state-machine tests; use a disposable database
npm run typecheck
npm run build
npm run provider:workspace:smoke
npm run provider:workspace:smoke -- --kernel
```

The provider smoke uses synthetic notes and bounded model/catalog calls. The optional Kernel step opens one retailer and deletes its browser. It makes no purchase.

References: [Vertex model](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash), [Google ADC](https://docs.cloud.google.com/docs/authentication/application-default-credentials), [Render Blueprint](https://render.com/docs/blueprint-spec), [Kernel](https://www.kernel.sh/docs/), [Channel3](https://channel3.ai/docs/).


## PayPal Sandbox shopping payments (12 November update)

Apply migrations through **0009_shopping_paypal** (`npm run db:migrate`), or the dev workspace automatically ensures 0008/0009 on the first shopping request. Keep the current ignored Sandbox merchant config and encryption key. Do not rotate the encryption key without a wallet migration.

In Purchase permission, connect PayPal (Sandbox). The buyer must log in and approve saving their **Personal Sandbox** wallet in PayPal's official window; never use a real PayPal buyer/card. The existing SDK, state-bound vault setup and encrypted `payment_connections` token are reused. An approval now pins the connection UUID and shows only a masked label. Old approvals without a wallet binding must be cancelled and approved again.

After the earned-goal run reaches checkout review (the person may enter fictional guest details in Live View and press “I'm done, continue”), code validates the exact item/variant/merchant/quantity/destination/USD/all-in total/cap/window/active permission. The retailer payment-label check is replaced by the actual bound Sandbox wallet check: the retailer is not being paid. RewardLoop creates one Orders v2 test payment for the validated total to its configured Sandbox merchant. `PayPal-Request-Id` is the attempt UUID; a separate capture operation, if needed, uses `<attempt>-capture`. A unique payment reservation per approval survives process death. Only a matching completed capture yields `sandbox_paid` and consumes permission. The receipt shows PayPal order/capture IDs and `retailerOrderPlaced: false`. The retailer Place order button is never pressed.

Unknown results use **Check existing PayPal Sandbox order**, which GETs the recorded order without creating another. If CREATE timed out before returning an order ID, the run stays locked unknown and requires inspection in the Sandbox merchant dashboard using the attempt reference; no automatic retry or user no-order override is allowed. Revocation/disconnection/address updates serialize against payment dispatch locks. Revocation before dispatch prevents the payment; an in-flight request must be reconciled.

Current verified scope: automated state-machine/HTTP-adapter tests, typecheck, build, merchant OAuth and official SDK button rendering. A real buyer-approved vault and completed live Sandbox capture in this new flow still need the user's login and a readable retailer review page. Never present test-provider responses as live capture evidence. The /sandbox standalone flow remains available.

API reference: https://developer.paypal.com/platforms/checkout/save-payment-methods/purchase-later/payment-tokens-api/paypal/
