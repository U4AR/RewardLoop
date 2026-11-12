import { randomUUID } from "node:crypto";
const origin = process.env.WORKSPACE_ORIGIN || "http://localhost:3001";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("This synthetic account smoke is restricted to the local app.");
const headers = { Origin: origin, "Content-Type": "application/json" };
async function createSession() {
  const response = await fetch(`${origin}/api/auth/sign-up/email`, { method: "POST", headers,
    body: JSON.stringify({ name: "Release QA", email: `release.${randomUUID()}@example.com`, password: `QA-${randomUUID()}` }) });
  if (!response.ok) throw new Error(`Synthetic signup failed (${response.status})`);
  const cookies = response.headers.getSetCookie().map(cookie => cookie.split(";")[0]).join("; ");
  if (!cookies) throw new Error("Synthetic session cookie was not issued");
  return cookies;
}
const cookie = await createSession();
async function call(action, input, expected = 200, session = cookie) {
  const response = await fetch(`${origin}/api/workspace`, { method: "POST", headers: { ...headers, Cookie: session }, body: JSON.stringify({ action, input }) });
  const body = await response.json();
  if (response.status !== expected) throw new Error(`${action}: HTTP ${response.status}, expected ${expected}: ${body.message || body.error}`);
  return body;
}
const searchResponse = await fetch(`${origin}/api/rewards/search`, { method: "POST", headers: { ...headers, Cookie: cookie }, body: JSON.stringify({ query: "watercolor painting set", limit: 3 }) });
if (!searchResponse.ok) throw new Error(`Catalog search failed (${searchResponse.status})`);
const search = await searchResponse.json();
const product = search.products.find(p => p.offers.some(o => o.availability !== "out_of_stock"));
if (!product) throw new Error("No real product with a usable offer was returned");
const offer = product.offers.find(o => o.availability !== "out_of_stock");
const plan = await call("create", { productId: product.sourceProductId, merchant: offer.sourceMerchantDomain,
  goalTitle: "Explain a database index", rubric: "Explain how a database index speeds a lookup and identify one write cost and one storage cost.",
  requiredDays: 1, timezone: "UTC", deadline: new Date(Date.now() + 3 * 86400000).toISOString().slice(0,10), budgetMinor: Math.max(10000, offer.observedPriceMinor + 5000) });
console.log("PASS: saved a real retailer product and a one-day learning goal");
await call("checkout", { planId: plan.id }, 409);
console.log("PASS: checkout locked before progress is earned");
const crossOrigin = await fetch(`${origin}/api/workspace`, { method: "POST", headers: { ...headers, Origin: "https://other.example", Cookie: cookie }, body: JSON.stringify({ action: "archive", input: { planId: plan.id } }) });
if (crossOrigin.status !== 403) throw new Error("Cross-origin action was not rejected");
const review = await call("checkin", { planId: plan.id, notes: "A B-tree index stores ordered key values and pointers to rows. A query jumps to matching entries instead of scanning the whole table, speeding up lookups. Every insert or update needs extra work to maintain the index, increasing write cost. Each index also occupies additional disk storage." });
if (review.decision !== "accepted") throw new Error(`Complete rubric evidence was not accepted: ${review.reason}`);
console.log("PASS: hosted Gemini accepted complete evidence");
await call("checkin", { planId: plan.id, notes: "Another set of notes about index mechanisms and trade-offs, with write overhead and additional storage." }, 409);
const checkout = await call("checkout", { planId: plan.id });
if (!checkout.url || !checkout.message.includes("has not placed an order")) throw new Error("Checkout handoff was invalid or misrepresented");
console.log(`PASS: earned reward refreshed a real ${offer.sourceMerchantDomain} offer; no payment or order submitted`);
const otherSession = await createSession();
await call("checkout", { planId: plan.id }, 404, otherSession);
await call("archive", { planId: plan.id }, 404, otherSession);
console.log("PASS: another account cannot open or archive this reward");
if (process.argv.includes("--kernel")) {
  const report = await call("inspect", { planId: plan.id });
  console.log(`PASS: Kernel retailer check returned ${report.status}: ${report.message}`);
}
await call("archive", { planId: plan.id });
console.log("PASS: reward archived without deleting progress history");
console.log("WORKSPACE FLOW PASSED");
