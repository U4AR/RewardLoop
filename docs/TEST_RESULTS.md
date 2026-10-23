# Test results

Updated 23 October 2026 on the local Windows workspace. Provider and browser observations below remain dated 7 October unless otherwise stated. This record distinguishes local code tests, real provider responses, and work that has not been tested.

| Test or run | Result | What it establishes |
| --- | --- | --- |
| `npm run typecheck` | Passed again on 23 October 2026 | Current TypeScript source type-checks. |
| `npm test` | Passed on 23 October 2026 after the local AI and Kernel cart additions: 16 files, 98 tests | Domain, permission revocation, app Host/Origin checks, mock-store, Channel3, local AI, Kernel cart, wallet, fresh Checkout, and PayPal worker/adapter contracts. Provider adapter calls in this suite use test doubles. No external payment occurred. |
| Local fixture walkthrough with PostgreSQL, Next app, and worker | Passed: synthetic signed-in user, one-day goal, accepted fixture notes, 1/1 distinct day, labelled fixture receipt | Persistence and the development path can reach a controlled simulated outcome. It is not a PayPal or AI-provider end-to-end result. |
| Channel3 live UI search | Passed: six real products returned with `Live Channel3 response` label | The approved local key can search through the server route. No source retailer order was made. |
| `npm run provider:channel3:smoke` | Search and product detail succeeded; one offer-source URL lookup returned `unsupported` | Search/detail provider access works; that sampled URL did not establish lookup success. The script bounds the request count and omits the key from output. |
| `npm run provider:local-ai:smoke` | Three real local Qwen3-1.7B inference calls on 23 October 2026: a substantive note accepted with `local_llama` provenance; an incomplete note and unsupported-duration claim withheld | The pinned local model and loopback adapter work for a fixture-payment demonstration. This is not Anthropic and cannot authorize PayPal Sandbox. |
| Local separate-host mock store | Passed: one-time code created on `localhost`, redeemed on `127.0.0.1`; synthetic Focus timer cart saved and persisted after reload | A distinct local hostname and store session work. `localhost/store` and `127.0.0.1/api/state` returned `404`; `127.0.0.1/store` and `localhost/` rendered. This is not a Kernel test. |
| Exact cart-bind database smoke | Passed: synthetic owner, goal and permission, redeemed store code, saved cart, and bind to that owner's purchase intent; temporary test data removed | The store session ID is explicitly associated with that intent. This is not a Sandbox or Kernel provider test. |
| Synthetic judge-user bootstrap smoke | Passed once: owner-controlled command created a `@rewardloop.test` demo user without printing its password | Local account creation works; no external judge can access a hosted app yet. |
| `npm run build` | Passed again on 23 October 2026 with exit code 0: Next.js 16.4.0 compiled, typechecked, and generated 18 static pages. Better Auth logged a database-schema validation warning because PostgreSQL was stopped. | Local production build only; no deployment or running database. |
| Final local restart and route check | PostgreSQL migrations applied; web app and worker started; app `/` and store `/store` returned `200` on their respective hosts, while the opposite-host paths returned `404` | The local preview is running. This does not establish public access or a provider-backed purchase. |
| Local secret and payment-boundary review | Rechecked 23 October: `.env.local`, database, build output, and dependencies are ignored by Git; a publishable-source scan found no configured provider key. The only secret-pattern hit was a regular expression used to read the local Channel3 key in a bounded smoke script. | This is a local review, not a penetration test or a real PayPal Sandbox transaction. Inspect the exact staged files before the first commit; the repository is still entirely uncommitted. |

## Acceptance evidence still missing

- **PayPal:** no observed OAuth token, Vault capability, saved test buyer wallet, order, completed capture, webhook, or payment reconciliation against Sandbox. Mocked responses cannot fill this gap.
- **AI for Sandbox:** no observed Anthropic model verdict. The genuine local Qwen verdict is separately labelled `local_llama` and restricted to fixture outcomes; it cannot unlock a Sandbox payment.
- **Kernel:** no account key, cloud browser/profile, first-session save/delete, second-session restore, or Live View demonstration. A local browser on two hostnames does not prove Kernel persistence. The app now queues an exact two-session cart job and the worker invokes its Kernel adapter, but only mocked tests have passed.
- **Full scenario:** no approved-cart-change recovery, over-cap stop and real Sandbox capture in a single provider-backed rehearsal. No hosted HTTPS judge route or resettable rehearsal has passed.
- **Release:** a temporary public repository was initialized and source publication is in progress; no public video, hosted deployment, or final Devpost submission confirmation. A 99-second prototype video remains unlisted for owner review and is excluded from the public source tree.

The detailed target cases are in the supplied brief and [ARCHITECTURE.md](ARCHITECTURE.md). New observations should add a command or provider response, date, and redacted IDs/statuses here, while keeping keys, cookies, setup codes, and account details out of the repository.
