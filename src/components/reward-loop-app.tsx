"use client";

import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { FreshSandboxCheckout } from "./fresh-sandbox-checkout";
import { MockStoreSetup } from "./mock-store-setup";

const authClient = createAuthClient();

type Product = Record<string, unknown>;
type Goal = Record<string, unknown>;
type Permission = Record<string, unknown>;
type Purchase = Record<string, unknown>;
type Evidence = Record<string, unknown>;

type AppState = {
  products: Product[];
  goal: Goal | null;
  permission: Permission | null;
  evidence: Evidence[] | Evidence | null;
  purchase: Purchase | null;
  providerMode: string | Record<string, unknown> | null;
};

type BusyAction = "goal" | "permission" | "revoke" | "evidence" | null;
type Step = "reward" | "goal" | "limit" | "cart" | "proof" | "pay" | "done" | "revoked";

const RAIL: Array<{ key: Step; label: string }> = [
  { key: "reward", label: "Reward" },
  { key: "goal", label: "Goal" },
  { key: "limit", label: "Limit" },
  { key: "cart", label: "Cart" },
  { key: "proof", label: "Proof" },
  { key: "pay", label: "Pay" },
];

const PRODUCT_ART: Record<string, string> = {
  "focus-timer-cream": "⏱",
  "study-lamp-sage": "💡",
  "notebook-set-blue": "📓",
};

function textField(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function numberField(record: Record<string, unknown> | null, ...keys: string[]) {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  }
  return null;
}

function productSku(product: Product) { return textField(product, "sku", "id"); }
function productTitle(product: Product) { return textField(product, "title", "name") || "Reward"; }
function productPrice(product: Product) { return numberField(product, "priceMinor", "priceCents", "observedPriceMinor"); }
function allIn(product: Product | null) {
  if (!product) return null;
  const parts = ["priceMinor", "shippingMinor", "taxMinor"].map((key) => numberField(product, key));
  return parts.every((value) => value !== null) ? parts.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null;
}

function reviewOf(item: Evidence) {
  const review = item.reviewResult;
  return review && typeof review === "object" && !Array.isArray(review) ? review as Record<string, unknown> : null;
}

function missingOf(item: Evidence): string[] {
  const missing = reviewOf(item)?.missingRequirements;
  return Array.isArray(missing) ? missing.filter((value): value is string => typeof value === "string") : [];
}

function money(minor: number | null) {
  return minor === null ? "—" : `$${(minor / 100).toFixed(2)}`;
}

function shortDate(iso: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function inTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = (key: string) => parts.find((part) => part.type === key)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function localTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; }
}

function addDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dollarsToMinor(value: string) {
  const trimmed = value.trim();
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

const FRIENDLY_ERRORS: Record<string, string> = {
  INVALID_INPUT: "Something in this form isn’t quite right. Check it and try again.",
  UNAUTHENTICATED: "Your session ended. Sign in again.",
  DUPLICATE_EVIDENCE: "You already sent these exact notes.",
  OUTSIDE_GOAL_PERIOD: "Today is outside your goal’s dates.",
  PERMISSION_REQUIRED: "Approve your spending limit first.",
  GOAL_NOT_FOUND: "Set up your goal first.",
};

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const value = body as Record<string, unknown>;
    if (typeof value.message === "string" && value.message.trim()) return value.message;
    if (typeof value.error === "string") return FRIENDLY_ERRORS[value.error] ?? (/^[A-Z_]+$/.test(value.error) ? fallback : value.error);
    if (value.error && typeof value.error === "object") {
      const nested = value.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
  }
  return fallback;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(body, "That didn’t go through. Try again."));
  return body as T;
}

function providerValue(mode: AppState["providerMode"], key: string) {
  if (typeof mode === "string") return mode;
  if (mode && typeof mode === "object" && typeof mode[key] === "string") return mode[key] as string;
  return "";
}

function reviewerName(provider: string, model: string) {
  if (provider === "google_vertex") return `Gemini (${model})`;
  if (provider === "local_llama") return `${model.replace(/-Q\d.*$/, "").replace(/-/g, " ")}, running on this computer`;
  if (provider === "anthropic") return `Claude (${model})`;
  if (provider === "fixture") return "the offline test rule";
  return "an AI reviewer";
}

/* ---------- Signed-out ---------- */

function AuthPanel({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = mode === "signup"
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
      if (result.error) throw new Error(result.error.message || "That didn’t work. Check your details.");
      setPassword("");
      await onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn’t work. Check your details.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="landing">
      <div className="landing-copy">
        <h1>Earn the things you want.</h1>
        <p className="landing-lede">Pick a reward. Show up for your goal. When an AI checks your proof, RewardLoop buys it for you with PayPal.</p>
        <div className="landing-card" aria-hidden="true">
          <div className="stamp-card stamp-card--demo">
            <div className="stamp-card__top"><span className="stamp-card__art">💡</span><div><strong>Study lamp</strong><span>Up to $40</span></div></div>
            <div className="stamp-row stamp-row--3">
              <span className="stamp stamp--on">✓</span><span className="stamp stamp--on">✓</span><span className="stamp" />
            </div>
            <p className="stamp-card__foot">One more day to go</p>
          </div>
        </div>
      </div>
      <div className="panel auth-panel">
        <div className="segmented" role="group" aria-label="Account">
          <button type="button" aria-pressed={mode === "signup"} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
          <button type="button" aria-pressed={mode === "signin"} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
        </div>
        <form onSubmit={submit} className="form">
          {mode === "signup" && (
            <label>Your name<input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} required /></label>
          )}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
          <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="8 characters or more" /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-wide" disabled={pending} type="submit">
            {pending ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    </section>
  );
}

/* ---------- Stamp card ---------- */

function StampCard({ product, done, total, cap, until, state, punched }: {
  product: Product | null; done: number; total: number; cap: number | null; until: string; state: Step; punched: boolean;
}) {
  const sku = product ? productSku(product) : "";
  const slots = Math.max(1, Math.min(total, 10));
  const earned = done >= total && total > 0;
  const foot = state === "done" ? "Earned and paid"
    : state === "revoked" ? "Purchase permission revoked"
    : earned ? "Unlocked. Time to pay."
    : total - done === 1 ? (done === 0 ? (total === 1 ? "One stamp unlocks it" : "One more stamp to go") : "One more stamp to go")
    : `${total - done} stamps to go`;
  return (
    <div className={`stamp-card ${product ? "" : "stamp-card--empty"} ${earned ? "stamp-card--earned" : ""}`}>
      <div className="stamp-card__top">
        <span className="stamp-card__art" aria-hidden="true">{PRODUCT_ART[sku] ?? "🎁"}</span>
        <div>
          <strong>{product ? productTitle(product) : "Your reward"}</strong>
          <span>{product ? (cap !== null ? `Up to ${money(cap)}${until ? `, by ${shortDate(until)}` : ""}` : money(productPrice(product))) : "Pick something you want"}</span>
        </div>
      </div>
      <div className={`stamp-row stamp-row--${slots}`} role="img" aria-label={`${done} of ${total} days earned`}>
        {Array.from({ length: slots }, (_, index) => {
          const on = index < done;
          const fresh = punched && index === done - 1;
          return <span key={index} className={`stamp ${on ? "stamp--on" : ""} ${fresh ? "stamp--fresh" : ""}`}>{on ? "✓" : ""}</span>;
        })}
        {slots === 1 && (state === "done" ? <span className="earned-seal earned-seal--inline">Earned</span> : <span className="stamp-inline">{foot}</span>)}
      </div>
      {slots > 1 && <p className="stamp-card__foot">{foot}</p>}
      {state === "done" && slots > 1 && <span className="earned-seal" aria-hidden="true">Earned</span>}
    </div>
  );
}

/* ---------- App ---------- */

export function RewardLoopApp() {
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const userId = session?.user?.id;
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState("");
  const [selectedSku, setSelectedSku] = useState("");
  const [goalTitle, setGoalTitle] = useState("Learn one database idea a day");
  const [rubric, setRubric] = useState("Explain how a database index speeds up lookups, and name its write and storage trade-offs.");
  const [timeZone] = useState(localTimeZone);
  const [startDate, setStartDate] = useState(() => inTimeZone(localTimeZone()));
  const [endDate, setEndDate] = useState(() => addDays(inTimeZone(localTimeZone()), 30));
  const [requiredDays, setRequiredDays] = useState(1);
  const [capDollars, setCapDollars] = useState("40.00");
  const [showDates, setShowDates] = useState(false);
  const [permissionConsent, setPermissionConsent] = useState(false);
  const [notes, setNotes] = useState("");
  const [punched, setPunched] = useState(false);
  const lastDays = useRef<number | null>(null);

  const refreshState = useCallback(async () => {
    try {
      setState(await jsonRequest<AppState>("/api/state"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn’t load your reward.");
    }
  }, []);

  useEffect(() => {
    if (userId) void refreshState();
    else setState(null);
  }, [userId, refreshState]);

  const products = Array.isArray(state?.products) ? state.products : [];
  const goal = state?.goal || null;
  const permission = state?.permission || null;
  const permissionStatus = textField(permission, "status", "state").toUpperCase();
  const activePermission = permissionStatus === "ACTIVE";
  const purchase = state?.purchase || null;
  const evidence = Array.isArray(state?.evidence) ? state.evidence : state?.evidence ? [state.evidence] : [];
  const primarySku = textField(permission, "primarySku") || selectedSku;
  const product = useMemo(() => products.find((item) => productSku(item) === primarySku) || null, [products, primarySku]);
  const goalId = textField(goal, "id", "goalId");
  const acceptedDays = numberField(goal, "acceptedDays") ?? 0;
  const targetDays = numberField(goal, "requiredDays") ?? requiredDays;
  const purchaseStatus = textField(purchase, "status", "state").toUpperCase();
  const browser = textField(purchase, "browserProvider");
  const cartLinked = Boolean(browser && browser !== "Not prepared");
  const plannedSandbox = providerValue(state?.providerMode || null, "payment") === "paypal_sandbox";
  const plannedReviewer = providerValue(state?.providerMode || null, "evidence");
  const plannedModel = providerValue(state?.providerMode || null, "evidenceModel");
  const reviewerReady = ["anthropic", "google_vertex", "local_llama", "fixture"].includes(plannedReviewer) && (!plannedSandbox || plannedReviewer !== "fixture");
  const reviewer = reviewerName(textField(permission, "reviewProvider") || plannedReviewer, textField(permission, "reviewModel") || plannedModel);
  const receiptProvider = textField(purchase, "receiptProvider").toLowerCase();
  const pendingReview = evidence.some((item) => textField(item, "status").toUpperCase() === "PENDING");

  let step: Step;
  if (purchaseStatus === "CONFIRMED") step = "done";
  else if (!goal || !permission) step = !primarySku ? "reward" : !goal ? "goal" : "limit";
  else if (!activePermission) step = "revoked";
  else if (!cartLinked) step = "cart";
  else if (acceptedDays < targetDays) step = "proof";
  else step = "pay";
  const stepIndex = step === "done" ? RAIL.length : RAIL.findIndex((item) => item.key === step);

  // Keep status live while the reviewer or payment is working.
  useEffect(() => {
    if (!userId) return;
    if (!(pendingReview || step === "pay" || step === "cart")) return;
    const timer = window.setInterval(() => { void refreshState(); }, 2500);
    return () => window.clearInterval(timer);
  }, [userId, pendingReview, step, refreshState]);

  // Stamp the card when a new day is accepted.
  useEffect(() => {
    if (lastDays.current !== null && acceptedDays > lastDays.current) {
      setPunched(true);
      const timer = window.setTimeout(() => setPunched(false), 1800);
      lastDays.current = acceptedDays;
      return () => window.clearTimeout(timer);
    }
    lastDays.current = acceptedDays;
  }, [acceptedDays]);

  async function runAction(action: Exclude<BusyAction, null>, path: string, payload: Record<string, unknown>) {
    setBusy(action);
    setError("");
    try {
      await jsonRequest(path, { method: "POST", body: JSON.stringify(payload) });
      await refreshState();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That didn’t go through. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startDate >= endDate) { setError("The end date must come after the start date."); return; }
    await runAction("goal", "/api/goals", {
      title: goalTitle.trim(), rubric: rubric.trim(), timezone: timeZone,
      requiredDays, startDate, endDateExclusive: endDate,
    });
  }

  async function submitPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const totalCapMinor = dollarsToMinor(capDollars);
    const quote = allIn(product);
    if (totalCapMinor === null || totalCapMinor < 1) { setError("Enter an amount like 40.00."); return; }
    if (quote !== null && totalCapMinor < quote) { setError(`The limit must cover the full price of ${money(quote)}.`); return; }
    if (!goalId || !selectedSku) { setError("Pick a reward and set your goal first."); return; }
    const expectedSeller = textField(product, "seller");
    const variant = textField(product, "variant");
    if (!expectedSeller || !variant) { setError("Couldn’t read this reward’s details. Reload and try again."); return; }
    await runAction("permission", "/api/permissions", {
      goalId, primarySku: selectedSku, alternativeSkus: [], totalCapMinor,
      earliestDate: startDate, latestDate: endDate, ownerConfirmed: true,
      expectedSeller, expectedVariants: { [selectedSku]: variant },
      expectedMode: plannedSandbox ? "paypal_sandbox_fresh" : "fixture",
      expectedReviewerProvider: plannedReviewer, expectedReviewerModel: plannedModel,
    });
  }

  async function revokeCurrentPermission() {
    const permissionId = textField(permission, "id");
    if (!permissionId || !activePermission) return;
    await runAction("revoke", "/api/permissions/revoke", { permissionId });
  }

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (notes.trim().length < 20) { setError("Write a bit more: at least 20 characters."); return; }
    const saved = await runAction("evidence", "/api/evidence", { goalId, notes: notes.trim() });
    if (saved) setNotes("");
  }

  function chooseProduct(sku: string, priceMinor: number | null) {
    setSelectedSku(sku);
    setError("");
    if (priceMinor !== null) setCapDollars((Math.ceil((priceMinor + 1000) / 500) * 5).toFixed(2));
  }

  const firstName = session?.user?.name?.split(" ")[0] ?? "";
  const quote = allIn(product);

  return (
    <div className="shell">
      <header className="topbar">
        <a href="/" className="brand" aria-label="RewardLoop home"><span className="brand-mark" aria-hidden="true">✓</span>RewardLoop</a>
        <div className="topbar-right">
          <span className="test-chip">PayPal Sandbox test mode</span>
          {userId && <button type="button" className="link-btn" onClick={async () => { await authClient.signOut(); setState(null); }}>Sign out</button>}
        </div>
      </header>

      <main>
        {sessionPending ? (
          <div className="loading" role="status">Loading…</div>
        ) : !userId ? (
          <AuthPanel onAuthenticated={async () => { await refetchSession(); }} />
        ) : !state ? (
          <div className="loading" role="status">Loading your reward…</div>
        ) : (
          <div className="workspace">
            <aside className="workspace-card">
              <p className="hello">{firstName ? `Hi ${firstName}.` : "Hi."}</p>
              <StampCard product={product} done={Math.min(acceptedDays, targetDays)} total={goal ? targetDays : requiredDays}
                cap={numberField(permission, "totalCapMinor")} until={textField(permission, "latestDate")} state={step} punched={punched} />
              {goal && <p className="card-goal"><span>Goal</span>{textField(goal, "title")}</p>}
              {activePermission && step !== "done" && (
                <button type="button" className="link-btn link-btn--quiet" disabled={busy !== null} onClick={() => void revokeCurrentPermission()}>
                  {busy === "revoke" ? "Cancelling…" : "Cancel this purchase"}
                </button>
              )}
            </aside>

            <section className="flow" aria-live="polite">
              <ol className="rail" aria-label="Progress">
                {RAIL.map((item, index) => (
                  <li key={item.key} className={index < stepIndex ? "is-done" : index === stepIndex ? "is-current" : ""} aria-current={index === stepIndex ? "step" : undefined}>
                    <span className="rail-dot" aria-hidden="true">{index < stepIndex ? "✓" : index + 1}</span>{item.label}
                  </li>
                ))}
              </ol>

              {error && <p className="banner-error" role="alert">{error}</p>}

              {step === "reward" && (
                <div className="step">
                  <h2>What do you want to earn?</h2>
                  <p className="step-lede">Pick one. You’ll unlock it by reaching your goal.</p>
                  <div className="products">
                    {products.filter((item) => item.available !== false).map((item) => {
                      const sku = productSku(item);
                      return (
                        <button type="button" key={sku} className="product" onClick={() => chooseProduct(sku, productPrice(item))}>
                          <span className="product-art" aria-hidden="true">{PRODUCT_ART[sku] ?? "🎁"}</span>
                          <strong>{productTitle(item)}</strong>
                          <span className="product-variant">{textField(item, "variant")}</span>
                          <span className="product-price">{money(productPrice(item))}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === "goal" && (
                <form className="step form" onSubmit={submitGoal}>
                  <h2>Set your goal</h2>
                  <p className="step-lede">Say what you’ll do and what counts as proof. An AI checks each day’s notes against it.</p>
                  <label>Goal<input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} required maxLength={120} /></label>
                  <label>What counts as proof<textarea value={rubric} onChange={(event) => setRubric(event.target.value)} required rows={3} maxLength={1000} /></label>
                  <div className="field-row">
                    <label className="days">Days to earn it
                      <span className="stepper">
                        <button type="button" aria-label="Fewer days" onClick={() => setRequiredDays((value) => Math.max(1, value - 1))}>−</button>
                        <input type="number" min={1} max={30} value={requiredDays} onChange={(event) => setRequiredDays(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} />
                        <button type="button" aria-label="More days" onClick={() => setRequiredDays((value) => Math.min(30, value + 1))}>+</button>
                      </span>
                    </label>
                    <p className="field-note">From {shortDate(startDate)} to {shortDate(addDays(endDate, -1))}. <button type="button" className="link-btn" onClick={() => setShowDates((value) => !value)}>{showDates ? "Done" : "Change dates"}</button></p>
                  </div>
                  {showDates && (
                    <div className="field-row">
                      <label>Starts<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
                      <label>Ends before<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
                    </div>
                  )}
                  <div className="actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setSelectedSku("")}>Back</button>
                    <button type="submit" className="btn btn-primary" disabled={busy !== null}>{busy === "goal" ? "Saving…" : "Save goal"}</button>
                  </div>
                </form>
              )}

              {step === "limit" && (
                <form className="step form" onSubmit={submitPermission}>
                  <h2>Set your spending limit</h2>
                  <p className="step-lede">RewardLoop can only buy this one item, once, for no more than this.</p>
                  <div className="limit">
                    <span className="limit-label">Most you’ll pay</span>
                    <span className="limit-input"><span>$</span><input inputMode="decimal" value={capDollars} onChange={(event) => setCapDollars(event.target.value)} required aria-label="Most you’ll pay, in US dollars" /></span>
                    <span className="limit-note">{product ? `${productTitle(product)} costs ${money(quote)} with tax and shipping.` : ""}</span>
                  </div>
                  <label className="check">
                    <input type="checkbox" checked={permissionConsent} onChange={(event) => setPermissionConsent(event.target.checked)} required />
                    <span>Buy {product ? productTitle(product).toLowerCase() : "this item"} for me once I’ve earned it, up to ${capDollars || "0"}, before {shortDate(endDate)}. {plannedSandbox ? "I’ll approve the payment on PayPal." : ""}</span>
                  </label>
                  {!reviewerReady && <p className="error">The AI reviewer isn’t set up on this computer yet.</p>}
                  <div className="actions">
                    <button type="submit" className="btn btn-primary" disabled={!permissionConsent || !reviewerReady || busy !== null}>{busy === "permission" ? "Saving…" : "Approve limit"}</button>
                  </div>
                </form>
              )}

              {step === "cart" && (
                <div className="step">
                  <h2>Put it in your cart</h2>
                  <p className="step-lede">It waits there, locked, until you’ve earned it.</p>
                  <MockStoreSetup sku={primarySku} onLinked={() => void refreshState()} />
                </div>
              )}

              {step === "proof" && (
                <form className="step form" onSubmit={submitEvidence}>
                  <h2>Show today’s progress</h2>
                  <blockquote className="rule">{textField(goal, "rubric")}</blockquote>
                  <label>Today’s notes
                    <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={6} minLength={20} maxLength={5000} required placeholder="What did you learn today?" />
                  </label>
                  <div className="actions actions--split">
                    <span className="reviewer">Checked by {reviewer}</span>
                    <button type="submit" className="btn btn-primary" disabled={busy !== null || pendingReview}>{busy === "evidence" ? "Sending…" : pendingReview ? "Checking…" : "Send for review"}</button>
                  </div>
                  {evidence.length > 0 && (
                    <ul className="reviews">
                      {evidence.slice(0, 3).map((item, index) => {
                        const status = textField(item, "status").toUpperCase();
                        const missing = missingOf(item);
                        return (
                          <li key={textField(item, "id") || index} className={`review review--${status.toLowerCase()}`}>
                            <span className="review-chip">{status === "ACCEPTED" ? "Stamped" : status === "PENDING" ? "Checking…" : "Not yet"}</span>
                            <span className="review-text">
                              {status === "PENDING" ? "The AI is reading your notes." : status === "ACCEPTED" ? "Your notes cover everything in the rule." : missing.length ? `Missing: ${missing.join("; ").replace(/\.$/, "")}.` : "This didn’t meet the rule yet. Add more detail."}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </form>
              )}

              {step === "pay" && (
                <div className="step">
                  <h2>You earned it.</h2>
                  <p className="step-lede">{product ? `${productTitle(product)}, ${money(quote)} total.` : ""} {plannedSandbox ? "Approve the payment with PayPal to finish." : "Finishing your test purchase…"}</p>
                  {plannedSandbox ? <FreshSandboxCheckout onChange={() => void refreshState()} /> : <p className="waiting">Processing…</p>}
                </div>
              )}

              {step === "done" && (
                <div className="step step--done">
                  <h2>It’s yours.</h2>
                  <p className="step-lede">{product ? productTitle(product) : "Your reward"} was paid for {receiptProvider.includes("paypal") ? "with PayPal" : "in test mode"}.</p>
                  <dl className="receipt">
                    <div><dt>Paid</dt><dd>{money(numberField(purchase, "totalMinor") ?? quote)}</dd></div>
                    {receiptProvider.includes("paypal") ? (
                      <>
                        <div><dt>PayPal order</dt><dd>{textField(purchase, "orderId")}</dd></div>
                        <div><dt>PayPal capture</dt><dd>{textField(purchase, "captureId")}</dd></div>
                      </>
                    ) : <div><dt>Payment</dt><dd>Offline test, no PayPal call</dd></div>}
                    <div><dt>Proof checked by</dt><dd>{reviewer}</dd></div>
                  </dl>
                  <p className="fine">Sandbox test money only. Nothing is charged or shipped.</p>
                </div>
              )}

              {step === "revoked" && (
                <div className="step">
                  <h2>Purchase cancelled</h2>
                  <p className="step-lede">RewardLoop won’t buy anything for this goal.</p>
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
