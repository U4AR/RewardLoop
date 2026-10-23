# Setup guide

Observed on 7 October 2026. Use the [status table](SETUP_STATUS.md) for what has actually been completed. This guide separates a working local fixture setup from provider account handoffs. Secrets belong only in `.env.local` or a provider secret store.

## Local fixture run

Follow the exact commands in [README](../README.md). The first `node scripts/init-local.mjs` call creates random local auth and encryption secrets without overwriting an existing `.env.local`. Keep PostgreSQL, the Next app, and the worker running in separate terminals. Migrations must run before the seed. The local account is synthetic and separate from PayPal Sandbox and the controlled mock store.

## Human account handoffs

| Platform | Exact URL and human action | Why | Resume point |
| --- | --- | --- | --- |
| PayPal Developer | [Developer Dashboard](https://developer.paypal.com/dashboard/): sign in with the intended existing PayPal account; complete password, MFA, or email verification there. | The session is at a PayPal sign-in screen and the owner must handle credentials. | Inspect existing Sandbox Business merchant, Personal buyer, REST app, Vault capability, and test credentials. Do not create a real business account for the demo. |
| Channel3 | [Developer Dashboard](https://trychannel3.com/dashboard/): the chosen Google account is signed in. One key was created, copied to ignored `.env.local` with owner approval, and used for bounded live search/detail. | The local key grants API-credit use; keep it out of chat and source. | Search/detail are verified. Try another supported product URL only if lookup coverage is needed; the sampled offer URL returned `unsupported`. |
| Kernel | [Kernel Dashboard](https://dashboard.onkernel.com/): the owner-selected account is signed in; an isolated project and restricted 30-day key have been created. | The key is in ignored local configuration. No live cloud browser run has occurred, and free-plan entitlement for this second project has not been verified. | Use a distinct reachable HTTPS mock-store host for a bounded two-session profile probe. Local `127.0.0.1` is not reachable from Kernel. |
| Anthropic | [Console login](https://platform.claude.com/login): sign in and complete any commercial terms/usage-policy step yourself, then select the intended organization. | No organization, budget, or credential has been confirmed; acceptance of terms is a human action. | Inspect credit/budget, configure a bounded `EVIDENCE_MODEL` and key, and test accepted, rejected, and uncertain responses. |
| GitHub | [Temporary public repository](https://github.com/U4AR/RewardLoop): the owner authorized this signed-in account for a provisional release. | Saved CLI sessions are expired, but the connected GitHub tool has repository push permission. | Publish the reviewed source through that connection, then verify the public tree and MIT license. The owner may later use another account. |
| Render | [Render dashboard](https://dashboard.render.com/): the selected account is signed in and the Hobby workspace has no services. Its Billing page showed $0.00 credits, no card, no pending charges, and 750 included monthly free instance hours. | The draft Blueprint selects paid web, worker, and database plans; the signed-in free account does not fund those automatically. | Review the exact paid quote and any sponsor-credit redemption before Blueprint sync. No deployment has occurred. |

The Devpost session already reaches [My projects](https://devpost.com/submit-to/31302-paypal-ai-hackathon/manage/submissions); it showed no project. Starting a project reached a reCAPTCHA that the owner must complete in the prepared tab before the draft form can be inspected. Participant identity and eligibility declarations still require owner confirmation. The official deadline is 12 November 2026 at noon PST, displayed as 13 November at 1:30 a.m. IST.

## PayPal Sandbox only

After sign-in, first inspect existing accounts under **Testing Tools → Sandbox Accounts**. PayPal's [sandbox account guide](https://developer.paypal.com/sandbox-testing/accounts) says Developer signup normally supplies a Business merchant and Personal buyer; reuse them if suitable. Under **Apps & Credentials → Sandbox**, reuse or create a dedicated REST app, inspect `Accept payments` and Vault, then securely configure client ID, secret, and merchant ID. A feature toggle is not proof that delayed, unattended Vault payment works. Run OAuth, setup-token approval, saved-token order, and reconciliation probes in that order. Buyer approval happens in PayPal's interface. Keep any live-mode app and credentials out of RewardLoop.

## Provider limits

Channel3 catalog prices are indicative, and `/checkout` is advertised as coming soon. A source retailer receives no order. The controlled mock store must be reachable by Kernel on a hostname distinct from the app hostname; `localhost` on this computer is not reachable from Kernel's cloud browser. Do not deploy a paid web/worker/database stack until its actual selected plans, credit balance, and recurring total are reviewed. Current deployment preparation is in [COSTS](COSTS.md).

For any approved Render deployment, set `DATA_ENCRYPTION_KEY` manually as a 32-byte base64url string (43 characters, no `=` padding), then share the same secret with the worker. The PayPal wallet encryption code rejects Render's differently encoded generated value. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"` and enter it only in Render's secret field; never place it in source or chat.

The deployment blueprint disables public sign-up. After migrations on a new database, run `npm run demo:bootstrap` once in an owner-controlled environment with `DEMO_USER_EMAIL` set to a synthetic `@rewardloop.test` address and `DEMO_USER_PASSWORD` set to a unique value of at least 16 characters. The script enables sign-up only in its own process, creates the account without printing credentials, and leaves an existing account unchanged. Give judge credentials through the approved private channel; do not commit or paste them into a public submission.
