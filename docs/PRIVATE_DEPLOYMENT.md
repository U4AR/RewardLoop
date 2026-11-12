# Private Render demo

The root blueprint selects Render's free Node web service. The main app needs one web process; it does not need the legacy background worker or local model. Migrations run at startup because the free plan does not support a pre-deploy command.

Keep `ALLOW_LOCAL_SIGNUP=false` and `ALLOW_FIXTURE_PROVIDERS=false`. Set `DEMO_ACCESS_USER=demo` and a randomly generated `DEMO_ACCESS_PASSCODE` in Render's private environment. Visitors first enter those credentials in the browser's HTTPS authentication prompt, then sign in with a provisioned RewardLoop account. The passcode is an additional gate, not a substitute for per-user sessions and data isolation. `/api/healthz` remains accessible for Render's probe; it returns only availability. Static assets are public. No passcode or judge password belongs in Git or the public project description.

Use the exact HTTPS service origin for both `APP_ORIGIN` and `BETTER_AUTH_URL`. Supply the existing database/encryption configuration and Channel3, Kernel and PayPal Sandbox credentials privately. The app only supports Sandbox payments; retailer order submission stays disabled. Browser callback requests still pass through the access gate.

This deployment selects `GOOGLE_AI_BACKEND=gemini_api`, a private `GEMINI_API_KEY` from the owner's non-billed AI Studio project, and `VERTEX_MODEL=gemini-3.5-flash-lite` (the model variable name is retained for compatibility). No Google service-account file is needed. Explicit API mode never falls back to paid Vertex credentials when a key, quota or request fails. Keep the key server-side; never prefix it with `NEXT_PUBLIC_`. Free-tier inputs/responses can be used to improve Google's products, so use fictional evidence and delivery data; the About page discloses the provider and processing. See [Google's terms](https://ai.google.dev/gemini-api/terms) and [pricing](https://ai.google.dev/gemini-api/docs/pricing).

Provision an account with `npm run demo:bootstrap` using a synthetic `DEMO_USER_EMAIL` ending in `@rewardloop.test` and a strong private `DEMO_USER_PASSWORD`. This does not open public registration or overwrite an existing account password.

Verify the health endpoint, the 401 response before the gate, the separate account login after the gate, product search and a real hosted review. Only rehearse payment with a Sandbox Personal buyer and fictional delivery details. Watch database expiry and provider-credit balances. Render free services can sleep when idle; a first request may take time to start.
