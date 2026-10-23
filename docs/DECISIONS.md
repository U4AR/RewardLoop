# Architecture decisions

Decisions recorded on 7 October 2026 from the supplied implementation brief and current official documentation. They are **design decisions**, not reports of a completed provider setup or successful transaction. [BUILD_STATUS.md](BUILD_STATUS.md) tracks implementation and [SETUP_STATUS.md](SETUP_STATUS.md) tracks observed access.

| ID | Decision and reason | Implementation consequence |
| --- | --- | --- |
| D-01 | Use one compact TypeScript package first. The brief's package boundaries matter more than a monorepo scaffold for the first slice. | Next.js app plus `src/domain`, `src/db`, `src/integrations`, and `src/worker`; split packages only if shared build needs justify it. |
| D-02 | Hard-code Sandbox-only financial execution. A production build flag must not become a live-payment switch. | Startup rejects a live PayPal host or non-sandbox mode. All completed demo payments use PayPal Sandbox; real retailer checkout remains absent. |
| D-03 | Treat Channel3 as discovery and our store as the only demo merchant. Catalog coverage does not imply checkout authority. | Keep source product/variant/offer references separate from the app-owned demo SKU, synthetic seller, and final store quote. Permission and receipt disclose the bridge and no shipment. |
| D-04 | Isolate the mock store by **hostname**, not merely a different path or port. A same-origin allowlist would also cover the app API and operator pages; browser cookies are not isolated by port. | Use separate store/app hosts and host-only cookies, a limited synthetic store account, and a server-validated single-use checkout ticket. The Kernel allowlist contains only the store host. |
| D-05 | Claim the exact synthetic-store quote in the same database transaction as the payment operation. The current demo SKUs have unlimited units, so availability and listing version are checked but no finite stock quantity is reserved. | Lock intent, permission, quote, listing, and lease; freeze the exact USD total and stable PayPal request ID before the call. If finite stock is introduced, add a transactional quantity reservation first. Reconcile uncertain outcomes before another attempt. |
| D-06 | Define a fresh immutable goal cycle for each isolated scenario run. A reset cannot reuse a captured transaction as a new reward. | One unique purchase intent per cycle; reset creates a new cycle ID and preserves earlier audit, operation, and Sandbox IDs. |
| D-07 | Separate RealClock from BusinessClock. Simulating a month must never age or extend a PayPal credential or worker lease. | Real time governs provider expiry and networking; pinned goal timezone/business time governs qualifying dates and purchase windows. Demo-clock changes durably trigger a due-window sweep. |
| D-08 | Treat unattended PayPal Vault payment as a capability to verify, not an assumption. PayPal says billing-agreement/reference-transaction setup requires account approval and configuration. | Probe Sandbox OAuth, Vault settings, setup-token creation, human approval, token exchange, and saved-token order. If unavailable, retain the design and use a clearly labelled fresh-human-approval Sandbox checkout. [PayPal guide](https://developer.paypal.com/api/payment-tokens/save-without-purchase/paypal). |
| D-09 | Persist a logical financial operation separately from a worker attempt. A retry or alternate browser/direct adapter must not create a second charge. | Freeze payload, operation generation, and `PayPal-Request-Id` for each mutation. Use endpoint-specific retention, reconcile ambiguous outcomes, and never infer safety from an expired lease. [Orders create](https://developer.paypal.com/api/orders/v2/orders-create/); [Vault token creation](https://developer.paypal.com/api/payment-tokens/v3/payment-tokens-create/). |
| D-10 | Use transactional outbox delivery and an explicit due-window sweep. A database commit followed by a best-effort enqueue can lose a purchase job. | Business state and outbox event commit together; dispatcher/worker are restart-safe. The sweep covers real elapsed time and operator-authorized demo-clock advances. |
| D-11 | Keep model decisions advisory. Submitted proof, catalog text, and store pages are untrusted input. | AI emits schema-validated evidence observations or fixed shopping-tool choices; trusted code counts days and enforces permission, quote, and payment scope. |
| D-12 | State every provider's provenance in demo evidence. A fixture is useful for development but cannot prove hackathon integration. | Mark catalog, evidence, browser, and payment as fixture or provider-backed per run; report genuine Sandbox IDs only after an authoritative PayPal response or verified event. |

## Open verification gates

These are checks to perform, not assumed results:

1. Confirm actual PayPal developer/Sandbox account access and whether the test merchant can complete Vault setup and payer-absent use. PayPal's [saved-wallet guide](https://developer.paypal.com/api/payment-tokens/save-without-purchase/paypal) documents the intended flow; an OAuth token or visible Vault toggle alone does not verify it.
2. Verify the exact [Orders API](https://developer.paypal.com/api/orders/v2/orders-create/) response for a saved-token transaction, including any completed capture in the create-order response. Do not always call capture afterward.
3. Verify Channel3's current schema and caching terms using an actual bounded response before claiming real catalog search works.
4. Verify Kernel profile lifecycle with two distinct sessions against a reachable mock-store host. The [profile documentation](https://www.kernel.sh/docs/browsers/profiles/save-and-reuse) is a contract reference, not evidence of persistence in this project.
5. Verify hosting cost and judge access before creating paid cloud resources. A local app is not a deployed judge build.

## Revisit only on evidence

The architecture may change when an installed SDK version, actual Sandbox capability response, provider terms, or meaningful test demonstrates a mismatch. Record that change here with the observed result. Do not silently weaken the Sandbox-only, no-retailer-order, user-permission, or one-purchase-per-cycle requirements.
