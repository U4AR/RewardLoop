# Kernel saved-browser demonstration

**Status on 7 October 2026:** A Google consent screen was reached, but no Kernel dashboard, key, profile, browser session, Live View, or two-session smoke test has been observed. The owner must finish the new account consent. Do not describe the demonstration as complete until distinct Kernel session IDs and restored mock-store state have been recorded.

The controlled store page and API are implemented behind a distinct configured `MOCK_STORE_ORIGIN`. App-auth `POST /api/mock-store/setup-code` issues a ten-minute one-time code, and the main app has a user-facing control to create it. The user enters the code at `/store` on the store host. That host sets a separate HttpOnly, host-only synthetic cookie and lets the user save one demo SKU plus a fictional US destination. `/api/store/cart` never commits a purchase. A Live View control has not been connected.

Next's host-routing proxy blocks app routes on the configured store host and blocks store routes on other hosts. The store page and API also check the configured origin independently. Framework static assets remain available so the store page can render.

In a local browser check, a code issued at `localhost:3000` signed in to the store at `127.0.0.1:3000`, saved a synthetic Focus timer cart, and displayed that same cart after reload. The app and store cross-host routes returned `404`. That verifies the local separation only; Kernel cannot reach the developer computer's `127.0.0.1`.

## Why Kernel is used

Kernel preserves a synthetic mock-store login and cart between two cloud-browser sessions. The browser never logs in to a real retailer, bank, or PayPal account and never places a real retailer order. The purchase service, outside the browser, owns the deterministic permission gate and PayPal Sandbox call.

The mock store must have a URL reachable from Kernel's cloud browser. A local `localhost` address on the developer's computer is insufficient. Before a live smoke test, use an approved public development URL or hosted sandbox store that exposes only the intended store surface, with separate store and app sessions.

## Exact lifecycle from current docs

The [Kernel profile guide](https://www.kernel.sh/docs/browsers/profiles/save-and-reuse) documents this TypeScript SDK sequence:

1. Create a dedicated profile with `kernel.profiles.create({ name })`. Keep one opaque profile name per app user.
2. Start a **headful writer** browser with `kernel.browsers.create({ profile: { name, save_changes: true }, start_url: MOCK_STORE_ORIGIN })`.
3. Return its `browser_live_view_url` only to the authenticated owner while setup is active. The user signs in to a limited synthetic store account, sets a fictional address, and prepares a demo cart. Pause the shopping agent while the person controls it.
4. On “Save and close,” call `kernel.browsers.deleteByID(browser.session_id)`. Closing Playwright or CDP alone does **not** save the profile. Confirm deletion before marking setup complete.
5. Start a second browser with `kernel.browsers.create({ profile: { name }, start_url: MOCK_STORE_ORIGIN })`. Omit `save_changes` when execution need not persist changes. Verify that the expected synthetic account and cart reappear, then delete this browser too.

The saved profile is a snapshot, not live synchronization. [Kernel's concurrency guidance](https://www.kernel.sh/docs/browsers/profiles/concurrency) says a later writer replaces the profile's complete state. The app must serialize profile writers with its own durable lease; merely listing active browsers before create has a race. Do not start an execution browser while a human setup writer still owns the profile.

## Local two-session probe scaffold

`scripts/kernel-two-session-probe.ts` is an explicitly invoked smoke probe, separate from the future human Live View flow. It first checks for a Kernel key, distinct public HTTPS store origin, one-time synthetic store code, and demo SKU. With those supplied, it creates a unique profile, signs in to the controlled store through fixed Playwright actions in a writer browser, saves a cart, deletes the writer, opens a second read-only browser, and checks that the same synthetic store session/cart is restored. It deletes both browsers and the temporary profile in cleanup. It outputs only redacted session/profile IDs, not the API key, code, cookies, CDP URL, or Live View URL. It makes no payment.

Run locally only after the account and reachable store are ready, with `KERNEL_API_KEY`, `APP_ORIGIN`, `MOCK_STORE_ORIGIN`, `STORE_SETUP_CODE`, and `PROBE_SKU` supplied through a secure local environment. Invoke `npx tsx scripts/kernel-two-session-probe.ts`. Kernel headful usage may incur a real cost; confirm available credits first. The script has **not** been executed against Kernel and does not establish the required user-guided Live View demonstration.

The [Live View guide](https://www.kernel.sh/docs/browsers/live-view) states that the view URL comes from the created browser and becomes invalid when that browser is deleted or times out. Treat it as a bearer capability: never log it or send it to an AI model; authorize every request for it against the app user and active setup. If embedded in an iframe, check playback with `KERNEL_PLAYING`, validate message origin, and allow the documented frame/WebSocket origins in CSP. A read-only view can use its documented `readOnly` option, but human setup needs an interactive view.

## Bounded smoke test and evidence

Use only the controlled store origin and a synthetic store account. Record privately and redact publicly:

- Kernel project, profile reference, and first session ID; no API key, cookie, CDP URL, or Live View token.
- Evidence that the user prepared the cart/address in the first Live View and that `deleteByID` completed.
- A **different** second session ID and observed restored account/cart state.
- Any approved change in the cart, the selected allowed alternative, and the store's server-side quote.
- Cleanup of both browser sessions, including failure and timeout paths.

The shopping model may select only fixed, validated mock-store actions. The browser broker blocks retailer domains, arbitrary redirects, private-network targets, and unknown URLs. A cart or page observation is never itself permission to charge; the server gate rechecks the exact item, variant, seller, synthetic destination, USD cap, quote version, window, goal, and PayPal Sandbox connection.

The [Kernel sponsor page](https://paypalaihackathon.devpost.com/details/kernel) advertises $50 of credits, but no credit has been confirmed in this account. The [current pricing page](https://www.kernel.sh/docs/info/pricing) lists Developer as free plus usage with $5 monthly included usage credit and a headful browser rate of $0.0001333336 per second. Confirm the actual project balance and limits before a paid run; count the human Live View time as active browser usage.
