# Private Render demo

The root blueprint selects Render's free Node web service. The main app needs one web process; it does not need the legacy background worker or local model. Migrations run at startup because the free plan does not support a pre-deploy command.

Keep `ALLOW_LOCAL_SIGNUP=false` and `ALLOW_FIXTURE_PROVIDERS=false`. Set `DEMO_ACCESS_USER=demo` and a randomly generated `DEMO_ACCESS_PASSCODE` in Render's private environment. Visitors first enter those credentials in the browser's HTTPS authentication prompt, then sign in with a provisioned RewardLoop account. The passcode is an additional gate, not a substitute for per-user sessions and data isolation. `/api/healthz` remains accessible for Render's probe; it returns only availability. Static assets are public. No passcode or judge password belongs in Git or the public project description.

Use the exact HTTPS service origin for both `APP_ORIGIN` and `BETTER_AUTH_URL`. Supply the existing database/encryption configuration and Channel3, Kernel and PayPal Sandbox credentials privately. The app only supports Sandbox payments; retailer order submission stays disabled. Browser callback requests still pass through the access gate.

For Vertex AI, use a dedicated Google service identity restricted to inference in the configured project, supplied through ADC/Render's secret-file store. Do not copy a developer's gcloud profile. A private secret file can be referenced with `GOOGLE_APPLICATION_CREDENTIALS=/etc/secrets/google-credentials.json`.

Provision an account with `npm run demo:bootstrap` using a synthetic `DEMO_USER_EMAIL` ending in `@rewardloop.test` and a strong private `DEMO_USER_PASSWORD`. This does not open public registration or overwrite an existing account password.

Verify the health endpoint, the 401 response before the gate, the separate account login after the gate, product search and a real hosted review. Only rehearse payment with a Sandbox Personal buyer and fictional delivery details. Watch database expiry and provider-credit balances. Render free services can sleep when idle; a first request may take time to start.
