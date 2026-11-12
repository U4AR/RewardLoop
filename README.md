# RewardLoop — earn the things you want

The current app is a real-product reward workspace: Channel3 discovery, hosted Google Cloud Gemini progress review, Kernel retailer-page checks, saved goals, daily check-ins, and direct retailer handoff. The primary flow has no local model dependency or fictional shop.

New in this release: text, photo and voice check-ins, multiple habits, a daily calendar, an automatic habit journal, gift rewards, and a **Kernel shopping agent**. One-time purchase permission binds the exact item, variant, merchant, quantity one, destination, PayPal Sandbox wallet, USD cap and expiry. Once the habit is earned, the agent starts automatically, opens an isolated retailer browser, fills eligible delivery fields through restricted code and validates checkout. Only a matching checkout can trigger an exact-amount PayPal Sandbox payment. Login and CAPTCHA hand control to the person. A completed $29.95 Sandbox capture was verified in the final MiiR mug demo. **The retailer order is never placed; no real item is bought or shipped.** See the [workspace guide](docs/WORKSPACE_DEPLOYMENT.md) and [test report](docs/SHOPPING_AGENT_TEST_REPORT.md).

The Render demo uses the free web plan with the existing PostgreSQL database. `DEMO_ACCESS_USER` and a private `DEMO_ACCESS_PASSCODE` protect the site before normal Better Auth account sign-in; public registration stays disabled. Production fails closed if the passcode is missing. Configure all credentials privately and use a dedicated Google runtime identity, never a developer's gcloud profile. Free databases expire; verify retention before judging. See [private deployment](docs/PRIVATE_DEPLOYMENT.md).

[Watch the final hackathon demo](https://youtu.be/HjQBsC4a5kI) (unlisted, 2:45, with captions).

Start the configured local app with `npm run dev:workspace` and open **http://localhost:3001**. A PostgreSQL database and the configured provider credentials are required. Run migrations with `npm run db:migrate` and `npm run auth:migrate` first.

See [Workspace deployment](docs/WORKSPACE_DEPLOYMENT.md) for the Render blueprint, container deployment, Google runtime identity, provider configuration, and current product boundaries. Tests: `npm test`; types: `npm run typecheck`; production build: `npm run build`.

The earlier PayPal Sandbox flow is retained separately at `/sandbox`. Its synthetic-store receipt is not a retailer order. The following original documentation describes that legacy integration; use the workspace guide for the current main app.

---
# RewardLoop

RewardLoop is a PayPal AI Hackathon project: a person chooses a reward, sets an evidence rule and spending limit, then earns one purchase after the goal qualifies. The store is controlled and synthetic. **Every completed demo payment must use PayPal Sandbox.** The app has no live-payment route, places no retailer order, and ships nothing.

## Current state

The signed-in flow supports a versioned goal and bounded purchase permission, evidence submission, background AI review, distinct-day counting, a synthetic quote, an exact cart binding, and a server purchase gate. A separate store hostname saves the synthetic cart. A real Channel3 catalog search and product-detail call succeeded with a locally configured key. The pinned [local Qwen reviewer](docs/LOCAL_AI.md) qualified a one-day goal in a Render-backed synthetic account. On 24 October, a US Sandbox test buyer approved a **$22.68 Notebook set** order under a **$25.00** cap, and the app recorded a confirmed PayPal Sandbox capture and synthetic store receipt. The direct Sandbox approval redirect was used after the JavaScript SDK popup failed in this browser. The older fixture receipt remains a separately labelled simulation. Anthropic, Kernel cloud-browser restoration, and hosted web access have not been verified. See [build status](docs/BUILD_STATUS.md), [setup status](docs/SETUP_STATUS.md), and [Render integration](docs/RENDER_HACKATHON.md).

## Local start

Use Node 24 and npm. PostgreSQL is required. The embedded local database command below works on this Windows workspace; Docker Compose provides an alternative.

```powershell
npm ci
node scripts/init-local.mjs
npm run db:local
```

Keep the database terminal open. In another terminal:

```powershell
npm run db:migrate
npm run auth:migrate
npm run db:seed
npm run dev
```

In a third terminal:

```powershell
npm run worker
```

Open `http://localhost:3000/`. Create a demo account using a synthetic email and password. Choose a controlled reward, create a one-day goal whose dates include today in its selected timezone, approve the exact item and cap, then submit a substantive note. The worker processes the review; refresh the dashboard to see the result. The local Qwen path is deliberately limited to a database-index explanation rubric that asks for lookup behavior and write/storage trade-offs; other rubrics need human review. For a real Sandbox rehearsal, configure that pinned reviewer and Sandbox credentials, disable fixture providers, approve the exact reviewer displayed in the permission, and link a synthetic store cart before attempting checkout. A fixture-only configuration can still produce a clearly labelled simulated receipt; it is not a PayPal payment.

To try the controlled store locally, use **Create one-time store code** in the signed-in app, then open `http://127.0.0.1:3000/store`, enter that code, and save a synthetic cart. Return to the app and choose **Use saved cart for this reward** to bind that exact store session to the purchase intent. `localhost` and `127.0.0.1` are separate hostnames here. The cart persists after reload; this local check does not prove the Kernel cloud-browser lifecycle. Any provider-backed Sandbox payment requires a bound cart and actual model-reviewed evidence.

Alternatively start PostgreSQL with `docker compose up -d postgres` before the migrations. Do not run both local database options on port 5432. The database and generated `.env.local` are ignored by Git.

## Provider configuration

Copy values into the ignored `.env.local` or a deployment secret store. Never commit or print secrets. `APP_ORIGIN`, `BETTER_AUTH_URL`, and the database URL must match the environment. `PAYPAL_ENV=sandbox`, `PAYMENT_PROVIDER=paypal_sandbox`, and `PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com` are fixed; the app rejects a live PayPal target. Real PayPal execution requires a configured Sandbox client, secret, merchant ID, and genuine buyer approval. Until Vault capability is proven, new Sandbox permissions use fresh buyer approval for each purchase; a saved-wallet path is also implemented but unverified. Real catalog discovery requires Channel3 credentials. Evidence review can use the pinned local Qwen model or a configured Anthropic adapter; Anthropic has not been tested with this account. Kernel requires its own key and a separately hosted mock-store origin reachable from its browser.

`ALLOW_FIXTURE_PROVIDERS=true` is allowed only on localhost for development. Turn it off for a provider-backed judge build. A configured key or SDK route does not establish a successful integration test; each provider's observed status is tracked in the setup record.

With Sandbox app credentials in the ignored `.env.local`, run `npm run provider:paypal:sandbox-oauth` to test one OAuth connection. It prints only token expiry metadata, makes no payment, and requires network access to `https://api-m.sandbox.paypal.com`.

For genuine local text review without cloud AI credentials, follow [LOCAL_AI.md](docs/LOCAL_AI.md) and run `npm run provider:local-ai:smoke` after starting the pinned model. Model weights stay in ignored `.local-models/`. The reviewer is pinned to each approved permission and can qualify a Sandbox goal; only the deterministic purchase gate may initiate a PayPal Sandbox order.

## Checks and documentation

```powershell
npm run typecheck
npm test
npm run build
```

- [Architecture and corrected boundaries](docs/ARCHITECTURE.md)
- [Local and provider setup](docs/SETUP_GUIDE.md)
- [PayPal Sandbox flow](docs/PAYPAL_SANDBOX.md)
- [Channel3 catalog](docs/CHANNEL3.md)
- [Local AI reviewer](docs/LOCAL_AI.md)
- [Render hackathon integration](docs/RENDER_HACKATHON.md)
- [Kernel browser lifecycle](docs/KERNEL_DEMO.md)
- [Security limits](docs/SECURITY.md)
- [Costs and deployment gate](docs/COSTS.md)
- [Test results](docs/TEST_RESULTS.md)
- [Demo rehearsal](docs/DEMO_SCRIPT.md)
- [Submission draft and release status](docs/SUBMISSION.md)

The temporary [public repository](https://github.com/U4AR/RewardLoop) contains an earlier reviewed source release and its MIT license; local changes for the Qwen-to-Sandbox path still need publication. The 99-second unlisted prototype video shows a fixture receipt and needs replacement with the captured Sandbox run. A Devpost project draft exists and is not a finalized submission. Render hosts the free PostgreSQL database used by the successful run; no Render web service or worker is deployed. There is no hosted judge demo yet. The Render free database expires 23 November 2026, before judging, so reproducible judge access requires a retention plan and a fresh rehearsal.
