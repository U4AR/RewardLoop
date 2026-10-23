# Demo and rehearsal script

Updated 23 October 2026. A 99-second captioned local-prototype walkthrough has been rendered from screens observed on 23 October and is held privately for owner review. It shows a fixture review and a fixture receipt, with PayPal order and capture explicitly **Not run**. It is a provisional product demo, not proof of the required provider-backed hackathon flow. The final entry still needs observed provider results.

The [video source and redacted screenshots](../video/README.md) are included so the cut can be revised after a genuine Sandbox capture and AI review. No video upload has happened yet.

## Local rehearsal available now

1. Follow [README.md](../README.md) to start PostgreSQL, run migrations and seed data, then start the app and worker. Use a synthetic demo account at `http://localhost:3000/`.
2. Search Channel3 for a bounded query such as “study timer” and confirm the UI says **Live Channel3 response**. Show its source attribution and indicative offer without following a retailer checkout link. This search is separate from the demo-store reward currently used by the purchase flow.
3. Select an app-owned demo item such as Focus timer. Save a one-day observable goal whose date includes today in the chosen timezone; approve its exact item, window, synthetic destination, and USD total cap. Make clear that saving a wallet and approving the item are different actions. The wallet is not configured yet.
4. Use **Create one-time store code** in the app. In a separate browser tab open `http://127.0.0.1:3000/store`, enter the code, choose Focus timer, and save the synthetic cart. Reload and show that the cart remains. Return to the app and choose **Use saved cart for this reward**; that links this exact store session to the active purchase intent. The local two-host store and the cart bind have been checked separately, but the combined browser sequence should be rehearsed before recording. This does not prove Kernel profile persistence. Use only fictional destination details.
5. Back in the app, submit specific text notes meeting the fixture rule. Let the worker process them, then refresh the dashboard. Show the 1/1 distinct-day result and the **Fixture only · No PayPal payment** receipt with PayPal order and capture marked **Not run**. Fixture notes never qualify a provider-backed Sandbox payment.
6. If rehearsing permission revocation, use a **fresh goal cycle**. Revoke before the worker commits, refresh, and show that a new commit is refused. Do not represent a revocation after an in-flight provider call as canceling that call.

This walkthrough is useful for product and guardrail review. It **cannot** be used as the final hackathon proof of AI, Kernel, or PayPal Sandbox integration.

## Intended final video: target 2 minutes 40 seconds

Only record these provider shots after they have individually passed and a clean provider-backed rehearsal succeeds. A simulated month of business time does not prove that a browser login or payment token has remained valid for 30 real days.

| Time | Planned shot | Evidence required before filming |
| --- | --- | --- |
| 0:00–0:15 | The problem: choose a reward now, earn it by meeting a measurable goal. Identify the demo as PayPal Sandbox. | Working judge build. |
| 0:15–0:40 | Real Channel3 product result, exact app-owned demo reward mapping, goal, allowed alternative, USD cap; concise genuine Sandbox wallet approval if Vault is available. | Live catalog result and actual PayPal buyer approval. If Vault fails capability testing, show the fresh-approval route accurately. |
| 0:40–1:05 | Human prepares synthetic cart in Kernel Live View; app saves profile and closes the first browser. | Authorized Live View and confirmed first `deleteByID`. |
| 1:05–1:30 | Clearly labelled seeded prior demo history; final proof sent to actual evidence model, with its decision and explanation. Advance the visible business clock only if supported. | Real model response and auditable seeded-history control. |
| 1:30–2:05 | New Kernel browser restores the synthetic store account/cart; primary item is unavailable; bounded agent selects the previously approved alternative; server checks final all-in quote. | Two distinct Kernel session IDs, restored state, approved cart change, and exact quote. |
| 2:05–2:25 | Server gate permits one PayPal Sandbox capture and shows a synthetic receipt. | Verified Sandbox order/capture IDs, expected merchant, USD total, and completed status; no real charge, retailer order, or shipment. |
| 2:25–2:40 | Separate over-cap scenario stops before payment. Close with why the bounded instruction matters. | Recorded guardrail test, not a fabricated provider failure. |

Do not compress an incomplete provider flow into a claim of completion. The final entry needs a genuine PayPal Sandbox capture and meaningful AI result. If an optional sponsor component remains unavailable, say so in the video and submission. The current 99-second video is deliberately labelled as a local fixture walkthrough.

## Reset, redaction, and verification

- Use a new immutable goal cycle and synthetic store setup code for each rehearsal. Keep old payment/audit records; never relabel an earlier capture as a new purchase. Prepare test inventory and an approved alternative before recording.
- Keep the worker running, confirm the selected business window, and stop if a payment operation is `OUTCOME_UNKNOWN` or pending. Reconcile it before another attempt.
- Hide API keys, client secrets, email addresses, setup codes, session cookies, Kernel Live View/CDP URLs, Vault tokens, and any private buyer/account details from captured frames and logs. Redacted Sandbox IDs/statuses may be shown as evidence.
- Verify the export visually and audibly from start to finish, under three minutes, with no misleading overlays. Record the actual run date, selected product/quote, provider provenance, and redacted response IDs privately in [TEST_RESULTS.md](TEST_RESULTS.md). No video upload has happened yet.
