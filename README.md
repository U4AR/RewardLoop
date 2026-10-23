# RewardLoop

RewardLoop is a PayPal AI Hackathon prototype: a person chooses a reward, sets an evidence rule and spending limit, then earns one purchase after the goal qualifies. The store is controlled and synthetic. **Every real demo payment must use PayPal Sandbox.** The app has no live-payment route, places no retailer order, and ships nothing.

## Current state

The local development slice supports sign-in, fixture reward selection, a versioned goal and bounded purchase permission, evidence submission, background review, distinct-day counting, a synthetic quote, a server purchase gate, and a fixture receipt. That receipt is explicitly labelled as a simulation and has no PayPal order or capture ID. A separate store hostname can save a synthetic cart and link that exact cart to the approved reward. A real Channel3 catalog search and product detail call have succeeded with a locally configured key. An optional [local AI reviewer](docs/LOCAL_AI.md) made real model calls for a fixture-payment demonstration; its provenance is `local_llama` and it cannot authorize PayPal Sandbox. PayPal Sandbox wallet and fresh buyer-approval paths are implemented locally, but neither has been verified against a PayPal account. Anthropic and Kernel also need actual provider-backed verification before the full hackathon scenario can be claimed. See [build status](docs/BUILD_STATUS.md) and [setup status](docs/SETUP_STATUS.md) for observed results.

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

Open `http://localhost:3000/`. Create a local demo account using a synthetic email and password. Choose a fixture reward, create a one-day goal whose dates include today in its selected timezone, approve the exact item and cap, then submit specific notes. The worker processes the review and purchase attempt; refresh the dashboard to see the result. In the fixture configuration, accepted notes of at least 12 words produce a **fixture simulation**, not a PayPal payment.

To try the controlled store locally, use **Create one-time store code** in the signed-in app, then open `http://127.0.0.1:3000/store`, enter that code, and save a synthetic cart. Return to the app and choose **Use saved cart for this reward** to bind that exact store session to the purchase intent. `localhost` and `127.0.0.1` are separate hostnames here. The cart persists after reload; this local check does not prove the Kernel cloud-browser lifecycle. Any provider-backed Sandbox payment requires a bound cart and actual model-reviewed evidence.

Alternatively start PostgreSQL with `docker compose up -d postgres` before the migrations. Do not run both local database options on port 5432. The database and generated `.env.local` are ignored by Git.

## Provider configuration

Copy values into the ignored `.env.local` or a deployment secret store. Never commit or print secrets. `APP_ORIGIN`, `BETTER_AUTH_URL`, and the database URL must match the environment. `PAYPAL_ENV=sandbox`, `PAYMENT_PROVIDER=paypal_sandbox`, and `PAYPAL_API_BASE_URL=https://api-m.sandbox.paypal.com` are fixed; the app rejects a live PayPal target. Real PayPal execution requires a configured Sandbox client, secret, merchant ID, and genuine buyer approval. Until Vault capability is proven, new Sandbox permissions use fresh buyer approval for each purchase; a saved-wallet path is also implemented but unverified. Real catalog and evidence review require Channel3 and Anthropic credentials respectively. Kernel requires its own key and a separately hosted mock-store origin reachable from its browser.

`ALLOW_FIXTURE_PROVIDERS=true` is allowed only on localhost for development. Turn it off for a provider-backed judge build. A configured key or SDK route does not establish a successful integration test; each provider's observed status is tracked in the setup record.

For an optional genuine local text-review run without cloud AI credentials, follow [LOCAL_AI.md](docs/LOCAL_AI.md) and run `npm run provider:local-ai:smoke` after starting the pinned model. Model weights stay in ignored `.local-models/`. This reviewer can qualify only a fixture outcome; a PayPal Sandbox payment still requires the separately verified Anthropic path.

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
- [Optional local AI reviewer](docs/LOCAL_AI.md)
- [Kernel browser lifecycle](docs/KERNEL_DEMO.md)
- [Security limits](docs/SECURITY.md)
- [Costs and deployment gate](docs/COSTS.md)
- [Test results](docs/TEST_RESULTS.md)
- [Demo rehearsal](docs/DEMO_SCRIPT.md)
- [Submission draft and release status](docs/SUBMISSION.md)

The temporary [public repository](https://github.com/U4AR/RewardLoop) contains this source and its MIT license for the hackathon draft. A 99-second prototype video has been uploaded unlisted for owner review; its link and source assets are intentionally held out of this public repository until the owner approves release. The video shows a fixture receipt, not a PayPal Sandbox capture. A Devpost project draft exists; it is not a finalized submission. There is no hosted judge demo or verified provider-backed payment yet. Judges can use this local path after installing the dependencies and configuring their own provider credentials; that route has not yet been verified as a substitute for a hosted build.
