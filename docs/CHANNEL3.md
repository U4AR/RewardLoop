# Channel3 catalog integration

**Status updated 23 October 2026:** The account has one API key in ignored local configuration. A bounded live search on 7 October returned six products, a product-detail retrieval succeeded, and the signed-in UI displayed real results. A lookup of one sampled offer-source URL returned `unsupported`; no successful lookup of a different URL is claimed. The approved hackathon promotion added 20,000 bonus credits to the 1,000-credit monthly free tier with no payment method added. The checkout early-access email was sent on 23 October; no reply or checkout capability has been observed. See [SETUP_STATUS.md](SETUP_STATUS.md) and [ACCESS_REQUESTS.md](ACCESS_REQUESTS.md).

## Role and boundary

Channel3 supplies reward discovery. Its product and offer records are indicative catalog data, including a product ID, variant choices, retailer domain, offer link, availability, and observed price. A Channel3 retailer receives **no order** from this hackathon app. The app maps a selected catalog reference to an app-owned demo SKU; all completed purchases occur in our controlled simulated store through **PayPal Sandbox**. The app must never treat a Channel3 buy link as authorization for a retailer checkout.

The current [developer page](https://trychannel3.com/developers) labels `/checkout` as coming soon and directs early-access requests to `support@trychannel3.com`. Its terms and any test environment remain unverified. A compatible test-only checkout route may be evaluated later; no production retailer order is permitted in this build.

## Implemented adapter

`src/integrations/channel3.ts` exposes `Channel3Catalog` and a `CatalogProvider` boundary:

| Operation | Current documented endpoint | Adapter behavior |
| --- | --- | --- |
| `search(query, filters, limit)` | `POST https://api.trychannel3.com/v1/search` | Validates a bounded query, filters, and result count; fetches one page only. |
| `lookup(url)` | `POST https://api.trychannel3.com/v1/lookup` | Validates a public HTTP(S) URL, then returns a normalized product or an explicit unsupported result for provider 404/422. |
| `getProduct(reference)` | `GET https://api.trychannel3.com/v1/products/{product_id}` | Refreshes a saved product ID; a provider 404 returns `null`. |

The API key is supplied to the constructor on the server and sent in `x-api-key`; the module does not read environment variables or expose the key in returned data. Redirects are disabled. Provider error bodies are not propagated into ordinary exceptions.

Normalized products retain the Channel3 product ID, title, brand names, safe image URLs, selected variant and its exact product ID, available variant choices, timestamp of our observation, and USD offers. Each offer retains its retailer domain, attributed source URL, availability, condition, and integer USD cents. The current [API reference](https://docs.trychannel3.com/api-reference/v1/search) places price at `offer.price.price` and currency at `offer.price.currency`. A separate narrative example uses an older field name; the adapter follows the API reference. Decimal prices are converted without floating-point multiplication or rounding. Non-USD, malformed, or unsafe offers are excluded from purchase candidates; a product without an eligible USD offer remains discovery-only.

Pasted URLs reject credentials, private or literal IP hosts, non-HTTP(S) schemes, and custom ports. The app sends an accepted URL only to Channel3's lookup endpoint; it does not fetch or scrape the pasted address itself.

The authenticated Next.js endpoints are `POST /api/rewards/search` with `{ "query": "study lamp", "limit": 6 }` and `POST /api/rewards/lookup` with `{ "url": "https://..." }`. Both require the app session, the configured app origin, and `CHANNEL3_API_KEY`. Search returns `{ products, provenance: "channel3" }`; lookup returns `{ status: "found", product, provenance: "channel3" }` or an explicit unsupported result. When the key is absent they return `CHANNEL3_NOT_CONFIGURED`; they do not pretend a fixture is a live response. Responses are marked `no-store`.

## Freshness and costs

Persist product IDs and a small immutable approval snapshot for audit. The [Channel3 caching guide](https://docs.trychannel3.com/guides/caching) says to refresh product details whenever displayed, and to refresh offers and prices before showing them as current. Offer URLs are short-lived. Neither a past search result nor a catalog refresh is the final purchase quote; the simulated store's server quote and purchase gate decide whether the authorized total can be paid.

The [current pricing page](https://docs.trychannel3.com/pricing) lists 1,000 monthly free credits, one credit for search or lookup, a free product-detail call, and $0.007 per extra credit. The [hackathon sponsor page](https://paypalaihackathon.devpost.com/details/channel3) advertises 20,000 promotional credits using `PAYPAL-HACKATHON-2026`, with no credit card required. The account dashboard showed the 20,000-credit bonus after owner-approved redemption; no payment method or paid overage was configured. Credit expiry and future billing behavior have not been established. The adapter intentionally avoids automatic pagination and price tracking.

## Observed provider response and remaining check

The bounded smoke script ran search, fetched one returned product by ID, and tried URL lookup on one returned offer source. Search produced six products and product detail succeeded. The selected lookup URL produced the explicit `unsupported` result, which the UI must show honestly. No source retailer checkout or Channel3 checkout was attempted. The 16 adapter tests and four authenticated-route tests use simulated HTTP responses; the bounded smoke and UI search are separate live evidence. A supported lookup URL remains to be found if that operation is needed for the final recorded scenario.
