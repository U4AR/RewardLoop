/**
 * Real PostgreSQL tests for the purchase state machine (unique indexes, leases, idempotency, reconciliation).
 * They run when SHOPPING_DB_TEST_URL points at a migrated database and are skipped otherwise.
 * Kernel and Gemini are replaced by a scripted runtime; no retailer, card or provider is contacted.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PlannerDecision, Snapshot } from "../integrations/shopping-agent";

import { PayPalSandboxClient } from "../integrations/paypal-sandbox";
import { encryptVaultId } from "./paypal-wallet";
const DB = process.env.SHOPPING_DB_TEST_URL;
let paymentMode = "ok", createCalls = 0, getCalls = 0;
let requests: Array<{ id: string | null; body: any }> = [];
const sandboxClient = () => new PayPalSandboxClient({ apiBaseUrl: "https://api-m.sandbox.paypal.com", clientId: "test", clientSecret: "test", merchantId: "TESTMERCHANT", fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
  const path = String(url);
  if (path.endsWith("/v1/oauth2/token")) return Response.json({ access_token: "test", expires_in: 1000 });
  if (init?.method === "POST") {
    createCalls++;
    requests.push({ id: (init.headers as Record<string,string>)["PayPal-Request-Id"], body: JSON.parse(String(init.body)) });
    if (paymentMode === "timeout") throw new Error("timeout after dispatch");
  } else getCalls++;
  const ref = requests.at(-1)?.body.purchase_units[0].reference_id;
  return Response.json({ id: `ORD${ref.replaceAll("-", "").slice(0,20)}`, status: "COMPLETED", purchase_units: [{ reference_id: ref,
    payee: { merchant_id: "TESTMERCHANT" }, amount: { currency_code: "USD", value: "87.20" },
    payments: { captures: [{ id: `CAP${ref.replaceAll("-", "").slice(0,20)}`, status: "COMPLETED", amount: { currency_code: "USD", value: paymentMode === "mismatch" ? "99.00" : "87.20" } }] } }] });
}) as typeof fetch });
const merchant = "example-outdoor.com";
const page = (path: string, texts: string[], extra: Partial<Snapshot> = {}): Snapshot =>
  ({ url: `https://${merchant}${path}`, title: "t", text: texts.join(" "), elements: texts.map((text, i) => ({ i, tag: "button", role: "", text })), loginRequired: false, captcha: false, ...extra });
const REVIEW = page("/checkout/review", ["Place your order"]);
const CONFIRM = page("/order/confirmation", ["Thank you"]);
const happyPages = [page("/p/daypack", ["Add to Cart"]), page("/cart", ["Proceed to checkout"]), REVIEW, CONFIRM];
const happyDecisions: PlannerDecision[] = [
  { action: "click", index: 0, option: null, reason: "add" }, { action: "click", index: 0, option: null, reason: "checkout" },
  { action: "at_checkout_review", index: null, option: null, reason: "review" },
];
const home = { fullName: "Test Person", line1: "742 Evergreen Terrace", city: "Springfield", region: "OR", postalCode: "97403", country: "US" };

type Script = { pages: Snapshot[]; decisions: PlannerDecision[]; receipt?: { orderNumber: string | null; confirmed: boolean; totalMinor: number | null }; failAfterSubmit?: boolean; onStep?: () => Promise<void> };
let script: Script;
let offer: { available: boolean; priceMinor: number; url: string } | null;
const opened: string[] = [], closed: string[] = [], profilesSeen: string[] = [];

describe.skipIf(!DB)("purchase state machine (PostgreSQL)", () => {
  let shop: typeof import("./shopping");
  let pool: import("pg").Pool;
  beforeAll(async () => {
    process.env.DATABASE_URL = DB;
    process.env.PAYPAL_SANDBOX_MERCHANT_ID = "TESTMERCHANT";
    shop = await import("./shopping");
    pool = (await import("../db/client")).getPool();
    shop.setShoppingRuntime({
      paypal: sandboxClient,
      ensureProfile: async name => { profilesSeen.push(name); },
      openSession: async input => { const id = `sess-${opened.length + 1}`; opened.push(`${id}:${input.profileName}:${input.saveChanges}`); return { sessionId: id, liveViewUrl: `https://live.example/${id}` }; },
      closeSession: async id => { closed.push(id); },
      currentOffer: async () => offer,
      driver: () => {
        let at = 0;
        return {
          goto: async () => {},
          snapshot: async () => script.pages[Math.min(at, script.pages.length - 1)],
          click: async () => { if (script.failAfterSubmit && script.pages[at] === REVIEW) throw new Error("connection lost"); at++; await script.onStep?.(); },
          selectOption: async () => { at++; },
        };
      },
      planner: () => {
        let d = 0;
        return {
          decide: async () => script.decisions[Math.min(d++, script.decisions.length - 1)],
          extractCheckout: async () => ({ pageUrl: "", items: [{ title: "Trail Daypack 22L", variant: null, quantity: 1, matchesApprovedItem: true }], subtotalMinor: 7500, shippingMinor: 600, taxMinor: 620, totalMinor: 8720, currency: "USD", shipToText: "742 Evergreen Terrace, Springfield, OR 97403", paymentText: "Visa •••• 4242", placeOrderVisible: true }),
          extractReceipt: async () => ({ pageUrl: "", ...(script.receipt ?? { orderNumber: "EO-123456", confirmed: true, totalMinor: 8720 }) }),
        };
      },
    });
  });
  afterAll(async () => { shop?.setShoppingRuntime(null); });

  let alice: string, bob: string, planId: string;
  beforeEach(async () => {
    alice = `alice-${randomUUID()}`; bob = `bob-${randomUUID()}`;
    script = { pages: happyPages, decisions: happyDecisions };
    offer = { available: true, priceMinor: 7500, url: `https://${merchant}/p/daypack` };
    delete process.env.RETAILER_LIVE_ORDERS;
    paymentMode = "ok"; createCalls = 0; getCalls = 0; requests = [];
    await pool.query(`INSERT INTO payment_connections (user_id,environment,merchant_id,paypal_customer_id,encrypted_vault_id,status) VALUES ($1,'sandbox','TESTMERCHANT','test-customer',$2,'ACTIVE')`, [alice, encryptVaultId("test-vault", process.env.DATA_ENCRYPTION_KEY!)]);
    planId = (await pool.query(`INSERT INTO reward_plans (user_id,product_id,product,offer_url,merchant,goal_title,rubric,required_days,timezone,start_date,deadline,budget_minor,review_model)
      VALUES ($1,'prod-1',$2,$3,$4,'Learn databases','Explain index lookups and their costs',1,'UTC',CURRENT_DATE,CURRENT_DATE+30,9000,'gemini-3.8-flash') RETURNING id`,
    [alice, JSON.stringify({ title: "Trail Daypack 22L", selectedVariant: { options: [] } }), `https://${merchant}/p/daypack`, merchant])).rows[0].id;
  });
  const earn = () => pool.query("INSERT INTO reward_checkins (plan_id,user_id,business_date,notes,content_hash,status) VALUES ($1,$2,CURRENT_DATE,'notes',$3,'accepted')", [planId, alice, randomUUID()]);
  const setup = (user = alice) => shop.saveShoppingSetup(user, { destination: home, paymentLabel: "Visa ending 4242" });
  const approve = (mode: "dry_run" | "live" = "dry_run", cap = 9000) => shop.authorizePurchase(alice, { planId, totalCapMinor: cap, validUntil: new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10), mode, confirm: true });
  const run = async (key = randomUUID()) => { const a = await shop.startShoppingRun(alice, { planId, idempotencyKey: key }); await shop.settleShoppingWork(); return a; };
  const latest = async () => (await shop.shoppingState(alice, { planId })).attempts[0];

  it("isolates users: separate Kernel profiles and no access to another user's reward", async () => {
    expect(shop.profileNameFor(alice)).not.toBe(shop.profileNameFor(bob));
    await setup(); await setup(bob);
    await expect(shop.shoppingState(bob, { planId })).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    await expect(shop.startShoppingRun(bob, { planId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "PLAN_NOT_FOUND" });
    await earn(); await approve(); await run();
    expect(opened.at(-1)).toContain(shop.profileNameFor(alice));
    expect(opened.at(-1)).toContain(":false"); // shopping runs never write back to the profile
  });

  it("an address alone is not consent: no run without an explicit approval and an earned goal", async () => {
    await setup();
    await expect(shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NO_APPROVAL" });
    await approve();
    await expect(shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "GOAL_INCOMPLETE" });
    await expect(approve("live")).rejects.toMatchObject({ code: "LIVE_ORDERS_DISABLED" });
    await expect(approve("dry_run", 5000)).rejects.toMatchObject({ code: "CAP_TOO_LOW" });
  });

  it("dry run reaches checkout review, validates every term and stops before ordering", async () => {
    await setup(); await earn(); await approve();
    await run();
    const attempt = await latest();
    expect(attempt).toMatchObject({ state: "sandbox_paid", paymentSubmitted: true, receipt: { captureId: expect.stringMatching(/^CAP/), retailerOrderPlaced: false } });
    expect(attempt.validation).toMatchObject({ ok: true });
    expect(attempt.steps.map((s: { kind: string }) => s.kind)).toEqual(["navigate", "click", "click", "observe"]);
    expect(closed.length).toBeGreaterThan(0);
  });

  it("is idempotent and allows only one open run per approval", async () => {
    await setup(); await earn(); await approve();
    script = { pages: [page("/signin", ["Sign in"], { loginRequired: true })], decisions: [] };
    const key = randomUUID();
    const first = await run(key);
    const again = await shop.startShoppingRun(alice, { planId, idempotencyKey: key });
    const other = await shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() });
    expect(again.id).toBe(first.id);
    expect(other.id).toBe(first.id); // the open (handoff) run is returned instead of starting a second browser
    const count = await pool.query("SELECT COUNT(*)::int AS n FROM purchase_attempts t JOIN purchase_authorizations a ON a.id=t.authorization_id WHERE a.plan_id=$1", [planId]);
    expect(count.rows[0].n).toBe(1);
  });

  it("re-validates the address, item price and availability before every run", async () => {
    await setup(); await earn(); await approve();
    offer = { available: true, priceMinor: 9500, url: offer!.url };
    await expect(shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "OVER_CAP" });
    offer = null;
    await expect(shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "OFFER_CHANGED" });
    offer = { available: true, priceMinor: 7500, url: `https://${merchant}/p/daypack` };
    await shop.saveShoppingSetup(alice, { destination: { ...home, line1: "1 Other Street", postalCode: "10001" }, paymentLabel: "Visa ending 4242" });
    await expect(shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "DESTINATION_CHANGED" });
    expect((await shop.shoppingState(alice, { planId })).profile?.destinationChanged).toBe(true);
  });

  it("blocks a checkout whose all-in total exceeds the cap (the agent's observation is checked by code)", async () => {
    await setup(); await earn(); await approve("dry_run", 8000);
    await run();
    expect(await latest()).toMatchObject({ state: "blocked", error: expect.stringMatching(/exceeds the approved cap/) });
  });

  it("hands off at sign-in, keeps the session, and resumes to the review", async () => {
    await setup(); await earn(); await approve();
    script = { pages: [page("/signin", ["Sign in"], { loginRequired: true })], decisions: [] };
    const attempt = await run();
    expect(await latest()).toMatchObject({ state: "needs_handoff", liveViewUrl: expect.stringContaining("live.example") });
    script = { pages: [REVIEW], decisions: [{ action: "at_checkout_review", index: null, option: null, reason: "signed in" }] };
    await shop.resumeShoppingRun(alice, { attemptId: attempt.id }); await shop.settleShoppingWork();
    expect(await latest()).toMatchObject({ state: "sandbox_paid" });
  });

  it("revocation cancels a waiting run and stops a running one at its next checkpoint", async () => {
    await setup(); await earn(); await approve();
    script = { pages: [page("/signin", ["Sign in"], { loginRequired: true })], decisions: [] };
    await run();
    await shop.revokePurchase(alice, { planId });
    expect(await latest()).toMatchObject({ state: "cancelled" });
    await approve();
    script = { pages: happyPages, decisions: happyDecisions, onStep: async () => { await pool.query("UPDATE purchase_authorizations SET status='revoked' WHERE plan_id=$1", [planId]); } };
    await run();
    expect(await latest()).toMatchObject({ state: "cancelled", paymentSubmitted: false });
  });

  it("binds the encrypted wallet, uses the attempt id as PayPal-Request-Id and consumes the approval", async () => {
    await setup(); await earn(); const auth = await approve();
    expect(auth.paymentLabel).toMatch(/^PayPal Sandbox ·/);
    const stored = (await pool.query("SELECT a.payment_connection_id,c.id,c.encrypted_vault_id FROM purchase_authorizations a JOIN payment_connections c ON a.payment_connection_id=c.id WHERE a.id=$1", [auth.id])).rows[0];
    expect(stored.payment_connection_id).toBe(stored.id); expect(stored.encrypted_vault_id).not.toContain("test-vault");
    const first = await run();
    expect(createCalls).toBe(1); expect(requests[0].id).toBe(first.id);
    expect(requests[0].body).toMatchObject({ payment_source: { paypal: { vault_id: "test-vault" } }, purchase_units: [{ amount: { value: "87.20", currency_code: "USD" } }] });
    await shop.startShoppingRun(alice, { planId, idempotencyKey: (await pool.query("SELECT idempotency_key FROM purchase_attempts WHERE id=$1", [first.id])).rows[0].idempotency_key });
    expect(createCalls).toBe(1);
    await expect(shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: "NO_APPROVAL" });
    await expect(pool.query("INSERT INTO shopping_paypal_payments (attempt_id,authorization_id,total_minor) VALUES ($1,$2,8720)", [first.id, auth.id])).rejects.toMatchObject({ code: "23505" });
  });

  it("does not charge without full validation or after revocation", async () => {
    await setup(); await earn(); await approve("dry_run", 8000); await run(); expect(createCalls).toBe(0);
    await approve();
    script = { pages: happyPages, decisions: happyDecisions, onStep: async () => { await shop.revokePurchase(alice, { planId }); } };
    await run(); expect(createCalls).toBe(0); expect(await latest()).toMatchObject({ state: "cancelled" });
  });

  it("amount mismatch is unknown and GET reconciliation never creates a second order", async () => {
    await setup(); await earn(); await approve(); paymentMode = "mismatch";
    const first = await run(); expect(await latest()).toMatchObject({ state: "unknown", paymentSubmitted: true });
    expect(createCalls).toBe(1);
    const retry = await shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() }); expect(retry.id).toBe(first.id);
    paymentMode = "ok";
    await shop.reconcileShoppingRun(alice, { attemptId: first.id, outcome: "no_order" });
    expect(await latest()).toMatchObject({ state: "sandbox_paid", receipt: { captureId: expect.stringMatching(/^CAP/) } });
    expect(createCalls).toBe(1); expect(getCalls).toBe(1);
  });

  it("lost CREATE response has no known order id, stays unknown and cannot be cleared by a user's no-order claim", async () => {
    await setup(); await earn(); await approve(); paymentMode = "timeout";
    const first = await run(); expect(await latest()).toMatchObject({ state: "unknown", paymentSubmitted: true });
    await expect(shop.reconcileShoppingRun(alice, { attemptId: first.id, outcome: "no_order" })).rejects.toMatchObject({ code: "PAYPAL_ORDER_UNKNOWN" });
    expect(createCalls).toBe(1); expect(getCalls).toBe(0);
  });

  it("requires a connected wallet and blocks a disconnected or replaced wallet before charge", async () => {
    await setup(); await earn();
    await pool.query("UPDATE payment_connections SET status='REVOKED' WHERE user_id=$1", [alice]);
    await expect(approve()).rejects.toMatchObject({ code: "PAYPAL_WALLET_REQUIRED" });
    await pool.query("UPDATE payment_connections SET status='ACTIVE' WHERE user_id=$1", [alice]);
    await approve();
    await pool.query("UPDATE payment_connections SET status='REVOKED' WHERE user_id=$1", [alice]);
    await run(); expect(createCalls).toBe(0); expect(await latest()).toMatchObject({ state: "cancelled" });
  });

  it("concurrent starts still dispatch exactly one Sandbox payment", async () => {
    await setup(); await earn(); await approve();
    const [a,b] = await Promise.all([shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() }), shop.startShoppingRun(alice, { planId, idempotencyKey: randomUUID() })]);
    await shop.settleShoppingWork();
    expect(a.id).toBe(b.id); expect(createCalls).toBe(1); expect(await latest()).toMatchObject({ state: "sandbox_paid" });
  });
  it("a crash after durable payment reservation stays unknown even before the dispatch marker commits", async () => {
    await setup(); await earn(); const auth = await approve();
    const attempt = (await pool.query(`INSERT INTO purchase_attempts (authorization_id,user_id,idempotency_key,mode,state,lease_owner,lease_expires_at) VALUES ($1,$2,$3,'dry_run','running','dead',now()-interval '1 minute') RETURNING id`, [auth.id, alice, randomUUID()])).rows[0];
    await pool.query("INSERT INTO shopping_paypal_payments (attempt_id,authorization_id,total_minor) VALUES ($1,$2,8720)", [attempt.id, auth.id]);
    expect(await latest()).toMatchObject({ state: "unknown" }); expect(createCalls).toBe(0);
    await expect(shop.reconcileShoppingRun(alice, { attemptId: attempt.id, outcome: "no_order" })).rejects.toMatchObject({ code: "PAYPAL_ORDER_UNKNOWN" });
  });
  it("an interrupted run without payment is closed safely; with payment submitted it becomes unknown", async () => {
    await setup(); await earn(); await approve();
    const auth = (await pool.query("SELECT id FROM purchase_authorizations WHERE plan_id=$1 AND status='active'", [planId])).rows[0].id;
    await pool.query(`INSERT INTO purchase_attempts (authorization_id,user_id,idempotency_key,mode,state,lease_owner,lease_expires_at) VALUES ($1,$2,$3,'dry_run','running','dead',now()-interval '1 minute')`, [auth, alice, randomUUID()]);
    expect(await latest()).toMatchObject({ state: "blocked", error: expect.stringMatching(/before any payment step/) });
    await pool.query(`INSERT INTO purchase_attempts (authorization_id,user_id,idempotency_key,mode,state,lease_owner,lease_expires_at,payment_submitted_at) VALUES ($1,$2,$3,'live','running','dead',now()-interval '1 minute',now())`, [auth, alice, randomUUID()]);
    expect(await latest()).toMatchObject({ state: "unknown" });
  });

  it("a pre-approved purchase starts automatically, once, when the goal is earned", async () => {
    await setup(); await approve();
    expect(await shop.startPurchaseIfReady(alice, planId)).toBeNull();
    await earn();
    const first = await shop.startPurchaseIfReady(alice, planId);
    expect(first?.started).toBe(true);
    await shop.settleShoppingWork();
    await shop.startPurchaseIfReady(alice, planId);
    await shop.settleShoppingWork();
    expect((await pool.query("SELECT id FROM purchase_attempts WHERE user_id=$1", [alice])).rowCount).toBe(1);
  });

  it("without an approval, earning the goal starts nothing", async () => {
    await setup(); await earn();
    expect(await shop.startPurchaseIfReady(alice, planId)).toBeNull();
    expect((await pool.query("SELECT id FROM purchase_attempts WHERE user_id=$1", [alice])).rowCount).toBe(0);
  });

  it("another user cannot trigger someone else's automatic purchase", async () => {
    await setup(); await approve(); await earn();
    expect(await shop.startPurchaseIfReady(bob, planId)).toBeNull();
    expect((await pool.query("SELECT a.id FROM purchase_attempts a JOIN purchase_authorizations p ON p.id=a.authorization_id WHERE p.plan_id=$1", [planId])).rowCount).toBe(0);
  });
});
