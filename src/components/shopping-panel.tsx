"use client";

import { SandboxWallet } from "./sandbox-wallet";
import { useCallback, useEffect, useState, type FormEvent } from "react";

type Step = { at: string; kind: string; detail: string };
type Attempt = {
  id: string; mode: "dry_run" | "live"; state: string; steps: Step[]; error: string | null; liveViewUrl: string | null; paymentSubmitted: boolean;
  observation: { subtotalMinor?: number | null; shippingMinor?: number | null; taxMinor?: number | null; totalMinor?: number | null; items?: Array<{ title: string; variant: string | null; quantity: number | null }> } | null;
  validation: { ok: boolean; reasons: string[] } | null; receipt: { orderNumber?: string | null; orderId?: string; captureId?: string } | null; createdAt: string;
};
type Authorization = { id: string; productTitle: string; variantLabel: string; merchant: string; quantity: number; destinationLabel: string; paymentLabel: string; totalCapMinor: number; validUntil: string; mode: string; status: string };
type Shopping = {
  profile: { destinationLabel: string | null; paymentLabel: string | null; retailerReady: boolean; setupOpen: boolean; setupLiveViewUrl: string | null; destinationChanged: boolean } | null;
  walletConnected: boolean; authorization: Authorization | null; attempts: Attempt[]; liveOrdersEnabled: boolean; goalEarned: boolean; variantLabel: string; budgetMinor: number; deadline: string;
};

const money = (minor: number | null | undefined) => minor === null || minor === undefined ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
async function call<T>(action: string, input: unknown): Promise<T> {
  const response = await fetch("/api/workspace", { method: "POST", cache: "no-store", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, input }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "That did not go through. Please try again.");
  return data as T;
}
const STATE_LABEL: Record<string, string> = {
  queued: "Starting the shopping browser…", running: "Shopping agent at work", needs_handoff: "Waiting for you",
  dry_run_passed: "Ready at checkout. Order not placed (dry run)", blocked: "Stopped safely. Nothing was purchased", unknown: "Result unknown. Check before doing anything else",
  sandbox_paid: "Paid with PayPal · test payment, no store order placed",
  purchased: "Purchased. Merchant receipt verified", cancelled: "Cancelled. Nothing was purchased", reconciled_no_order: "Checked by you: no order", reported_purchased: "Order reported by you",
};

/** Display label only: the stored binding still records the PayPal Sandbox wallet. */
const payLabel = (label: string | null) => (label ?? "").replace(/PayPal Sandbox/g, "PayPal");

function LiveView({ url, label }: { url: string; label: string }) {
  const [preview, setPreview] = useState(false);
  return <div className="rw-shop-live"><div className="rw-shop-live-bar"><span className="rw-live-dot"/>{label}</div>
    <div className="rw-shop-live-actions"><a className="rw-button rw-button-dark" href={url} target="_blank" rel="noopener noreferrer">Open the private browser</a>
      <button type="button" className="rw-linkbtn" onClick={() => setPreview((v) => !v)}>{preview ? "Hide preview" : "Show preview here"}</button></div>
    {preview && <iframe src={url} title={label} allow="clipboard-read; clipboard-write" referrerPolicy="no-referrer"/>}</div>;
}

export function ShoppingPanel({ planId, merchant, productTitle, recipient = null, refreshKey = 0 }: { planId: string; merchant: string; productTitle: string; recipient?: string | null; refreshKey?: number }) {
  const [state, setState] = useState<Shopping | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [editing, setEditing] = useState(false);
  const load = useCallback(async () => { try { setState(await call<Shopping>("shopping", { planId })); } catch (e) { setError(e instanceof Error ? e.message : "Unable to load the shopping agent."); } }, [planId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  const latest = state?.attempts[0];
  const active = Boolean(state?.profile?.setupOpen || (latest && ["queued", "running"].includes(latest.state)));
  useEffect(() => { if (!active) return; const timer = setInterval(() => void load(), 2500); return () => clearInterval(timer); }, [active, load]);
  async function perform(name: string, fn: () => Promise<unknown>) { setBusy(name); setError(""); try { await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete this step."); } finally { setBusy(""); } }

  if (!state) return <section className="rw-shop"><p className="rw-muted">Loading the shopping agent…</p>{error && <p className="rw-error" role="alert">{error}</p>}</section>;
  const profile = state.profile, auth = state.authorization?.status === "active" ? state.authorization : null;
  const hasDestination = Boolean(profile?.destinationLabel);

  function saveSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void perform("setup", async () => { await call("saveSetup", { paymentLabel: "PayPal Sandbox", destination: {
      fullName: String(f.get("name")), line1: String(f.get("line1")), line2: String(f.get("line2") || "") || undefined, city: String(f.get("city")),
      region: String(f.get("region")), postalCode: String(f.get("postal")), country: String(f.get("country")), phone: String(f.get("phone") || "") || undefined } }); setEditing(false); });
  }
  function approve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void perform("approve", () => call("authorize", { planId, totalCapMinor: Math.round(Number(f.get("cap")) * 100), validUntil: String(f.get("until")), mode: "dry_run", confirm: true }));
  }
  const runAgent = () => perform("run", () => call("shop", { planId, idempotencyKey: crypto.randomUUID() }));

  return <section className="rw-shop" aria-labelledby="rw-shop-title">
    <div className="rw-shop-head"><div><span className="rw-eyebrow">AUTOMATIC PURCHASE</span><h3 id="rw-shop-title">Set it once. RewardLoop AI buys it when you’ve earned it.</h3></div>
      <span className="rw-shop-mode">{"Test payment · no store order"}</span></div>

    <ol className="rw-shop-steps">
      <li className={hasDestination ? "is-done" : ""}><div className="rw-shop-step-title"><span>1</span><strong>{recipient ? `Where should ${recipient}’s gift go?` : "Private delivery details"}</strong>{hasDestination && !editing && <button className="rw-text-button" onClick={() => setEditing(true)}>Change</button>}</div>
        {hasDestination && !editing ? <p className="rw-shop-fact">Ships to <b>{profile!.destinationLabel}</b> · Pays with <b>{payLabel(profile!.paymentLabel)}</b><br/><span className="rw-muted">Your address is encrypted. Only this masked label is shown.</span></p>
          : <form className="rw-form rw-shop-form" onSubmit={saveSetup}>
            <div className="rw-form-columns"><label>Full name<input name="name" required minLength={2} maxLength={120} autoComplete="name"/></label><label>Country<input name="country" defaultValue="US" required minLength={2} maxLength={2} autoComplete="country"/></label></div>
            <label>Street address<input name="line1" required minLength={3} maxLength={160} autoComplete="address-line1"/></label>
            <label>Apartment, suite (optional)<input name="line2" maxLength={160} autoComplete="address-line2"/></label>
            <div className="rw-form-columns"><label>City<input name="city" required minLength={2} maxLength={80} autoComplete="address-level2"/></label><label>State<input name="region" required minLength={2} maxLength={80} autoComplete="address-level1"/></label><label>ZIP<input name="postal" required minLength={3} maxLength={20} autoComplete="postal-code"/></label></div>
            <label>Phone for delivery (optional)<input name="phone" type="tel" maxLength={30} autoComplete="tel"/></label>
            <p className="rw-field-help">Saved encrypted. RewardLoop shows only a masked label.</p>
            <button className="rw-button rw-button-dark" disabled={!!busy}>{busy === "setup" ? "Saving…" : "Save privately"}</button></form>}
      </li>

      <li className={profile?.retailerReady ? "is-done" : ""}><div className="rw-shop-step-title"><span>2</span><strong>Your {merchant} account, in a private browser</strong>{profile?.retailerReady && <em>Ready</em>}</div>
        <p className="rw-muted">Kernel opens your own isolated browser profile. Sign in at {merchant} and prepare the same fictional delivery address there. Do not add a real card or place an order. RewardLoop never sees your retailer password.</p>
        {profile?.setupOpen && profile.setupLiveViewUrl ? <><LiveView url={profile.setupLiveViewUrl} label={`Private session at ${merchant}`}/>
          <div className="rw-shop-actions"><button className="rw-button rw-button-dark" disabled={!!busy} onClick={() => void perform("finish", () => call("setupFinish", { planId, ready: true }))}>{busy === "finish" ? "Saving your session…" : "I’m signed in and saved my details"}</button>
            <button className="rw-text-button" disabled={!!busy} onClick={() => void perform("finish", () => call("setupFinish", { planId, ready: false }))}>Close without saving</button></div></>
          : <button className="rw-button rw-button-outline" disabled={!!busy || !hasDestination} onClick={() => void perform("open", () => call("setupStart", { planId }))}>{busy === "open" ? "Opening a private browser…" : profile?.retailerReady ? "Reopen private session" : `Open private ${merchant} session`}</button>}
      </li>

      <li className={auth ? "is-done" : ""}><div className="rw-shop-step-title"><span>3</span><strong>Purchase permission</strong>{auth && <em>Approved</em>}</div>
        <div className="rw-shop-wallet"><SandboxWallet workspace onConnectionChange={load}/></div>
        {profile?.destinationChanged && <p className="rw-error">Your delivery details changed after you approved. Approve again before the agent can shop.</p>}
        {auth ? <><dl className="rw-shop-terms"><div><dt>Item</dt><dd>{auth.productTitle}</dd></div><div><dt>Variant</dt><dd>{auth.variantLabel}</dd></div><div><dt>Merchant</dt><dd>{auth.merchant}</dd></div>
          <div><dt>Quantity</dt><dd>{auth.quantity}</dd></div><div><dt>Ships to</dt><dd>{auth.destinationLabel}</dd></div><div><dt>Payment</dt><dd>{payLabel(auth.paymentLabel)}</dd></div>
          <div><dt>All-in cap</dt><dd>{money(auth.totalCapMinor)} incl. shipping & tax</dd></div><div><dt>Valid until</dt><dd>{new Date(auth.validUntil).toLocaleDateString()}</dd></div><div><dt>Requires</dt><dd>Goal earned</dd></div></dl>
          <button className="rw-text-button" disabled={!!busy} onClick={() => void perform("revoke", () => call("revoke", { planId }))}>{busy === "revoke" ? "Cancelling…" : "Cancel this permission"}</button></>
          : <form className="rw-form rw-shop-form" onSubmit={approve}><p className="rw-muted">Saving an address is not permission to buy. Approve exactly <b>{productTitle}</b> ({state.variantLabel}) from <b>{merchant}</b>, quantity 1.</p>
            <div className="rw-form-columns"><label>All-in cap (USD)<input name="cap" type="number" step="0.01" min={1} defaultValue={(state.budgetMinor / 100).toFixed(2)} required/></label><label>Valid until<input name="until" type="date" defaultValue={state.deadline} max={state.deadline} required/></label></div>
            <label className="rw-consent"><input type="checkbox" required/> Pay once with my connected PayPal for this exact item, to my saved address, only if the total including shipping and tax is within this cap, and only after I earn my goal. Test mode: no store order is placed.</label>
            <button className="rw-button rw-button-dark" disabled={!!busy || !hasDestination || !state.walletConnected}>{busy === "approve" ? "Saving permission…" : "Approve this purchase"}</button></form>}
      </li>

      <li className={latest?.state === "dry_run_passed" || latest?.state === "sandbox_paid" ? "is-done" : ""}><div className="rw-shop-step-title"><span>4</span><strong>Shopping agent</strong></div>
        {!latest || !["queued", "running", "needs_handoff", "unknown"].includes(latest.state) ? <>
          <p className="rw-muted">{state.goalEarned ? "Kernel returns to the retailer with your profile, adds this exact item, and reads the checkout. Code checks every term before any payment step." : "Starts automatically the moment your goal is earned. Nothing else to do."}</p>
          <button className="rw-button rw-button-dark" disabled={!!busy || !auth || !state.goalEarned} onClick={() => void runAgent()}>{busy === "run" ? "Starting…" : state.liveOrdersEnabled && auth?.mode === "live" ? "Run shopping agent" : "Run shopping agent"}</button></> : null}
        {latest && <div className={`rw-shop-run rw-shop-${latest.state}`}>
          <strong className="rw-shop-state">{STATE_LABEL[latest.state] ?? latest.state}</strong>
          {latest.liveViewUrl && <LiveView url={latest.liveViewUrl} label={latest.state === "needs_handoff" ? `Your turn at ${merchant}` : `Kernel browser at ${merchant}`}/>}
          {latest.state === "needs_handoff" && <><p>{latest.error} Enter fictional test contact and address details in the browser above, then continue. Never press the retailer’s Place order or Pay button. RewardLoop does not solve CAPTCHAs or enter passwords.</p>
            <div className="rw-shop-actions"><button className="rw-button rw-button-dark" disabled={!!busy} onClick={() => void perform("resume", () => call("resume", { attemptId: latest.id }))}>I’m done, continue</button>
              <button className="rw-text-button" disabled={!!busy} onClick={() => void perform("cancel", () => call("cancelRun", { attemptId: latest.id }))}>Stop</button></div></>}
          {latest.observation?.totalMinor !== undefined && latest.validation && <dl className="rw-shop-terms rw-shop-observed">
            <div><dt>Item</dt><dd>{latest.observation.items?.[0]?.title ?? "—"}</dd></div><div><dt>Subtotal</dt><dd>{money(latest.observation.subtotalMinor)}</dd></div>
            <div><dt>Shipping</dt><dd>{money(latest.observation.shippingMinor)}</dd></div><div><dt>Tax</dt><dd>{latest.observation.taxMinor == null && latest.observation.totalMinor != null && latest.observation.subtotalMinor != null && latest.observation.shippingMinor != null && latest.observation.totalMinor === latest.observation.subtotalMinor + latest.observation.shippingMinor ? "None" : money(latest.observation.taxMinor)}</dd></div>
            <div><dt>Total</dt><dd>{money(latest.observation.totalMinor)} {auth ? `of ${money(auth.totalCapMinor)} cap` : ""}</dd></div></dl>}
          {latest.validation && !latest.validation.ok && <ul className="rw-shop-reasons">{latest.validation.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
          {latest.state === "blocked" && latest.error && !latest.validation && <p>{latest.error}</p>}
          {latest.state === "unknown" && <><p>{latest.error} RewardLoop will only check the existing PayPal order. It will not create another payment.</p>
            <div className="rw-shop-actions"><button className="rw-button rw-button-outline" disabled={!!busy} onClick={() => void perform("rec", () => call("reconcile", { attemptId: latest.id, outcome: "no_order" }))}>Check existing PayPal order</button></div></>}
          {latest.state === "sandbox_paid" && <p>Paid with PayPal · capture {latest.receipt?.captureId}. Test payment; no store order placed.</p>}
          {latest.receipt?.orderNumber && latest.state === "purchased" && <p>Order {latest.receipt.orderNumber}</p>}
          {latest.steps.length > 0 && <ol className="rw-shop-log">{latest.steps.slice(-8).map((s, i) => <li key={i} className={`is-${s.kind}`}>{s.detail}</li>)}</ol>}
          {latest.state === "dry_run_passed" && <p className="rw-muted">Dry run: the agent stopped on the review page. No order was placed and no payment was submitted.</p>}
        </div>}
      </li>
    </ol>
    {error && <p className="rw-error" role="alert">{error}</p>}
  </section>;
}
