"use client";

import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CatalogDiscovery } from "./catalog-discovery";
import { FreshSandboxCheckout } from "./fresh-sandbox-checkout";
import { MockStoreSetup } from "./mock-store-setup";
import { SandboxWallet } from "./sandbox-wallet";

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

type BusyAction = "goal" | "permission" | "revoke" | "evidence" | "refresh" | null;

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

function productSku(product: Product) {
  return textField(product, "sku", "id");
}

function productTitle(product: Product) {
  return textField(product, "title", "name") || "Demo reward";
}

function productPrice(product: Product) {
  return numberField(product, "priceMinor", "priceCents", "observedPriceMinor");
}

function evidenceReason(item: Evidence) {
  const review = item.reviewResult;
  if (review && typeof review === "object" && !Array.isArray(review)) {
    const reason = textField(review as Record<string, unknown>, "reason");
    if (reason) return reason;
  }
  const directReason = textField(item, "reviewReason", "reason");
  if (directReason) return directReason;
  const status = textField(item, "status", "decision").toUpperCase();
  return status === "ACCEPTED" || status === "REJECTED" ? "Reviewed against your evidence rule." : "Review in progress";
}

function money(minor: number | null) {
  return minor === null ? "Price unavailable" : `$${(minor / 100).toFixed(2)}`;
}

function inTimeZone(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (key: string) => parts.find((part) => part.type === key)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}`;
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

function errorMessage(body: unknown, fallback: string) {
  if (body && typeof body === "object") {
    const value = body as Record<string, unknown>;
    if (typeof value.error === "string") return value.error;
    if (value.error && typeof value.error === "object") {
      const nested = value.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
    if (typeof value.message === "string") return value.message;
  }
  return fallback;
}

async function jsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorMessage(body, `Request failed (${response.status}).`));
  }
  return body as T;
}

function statusClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("confirm") || normalized.includes("complete") || normalized.includes("accept")) return "status-success";
  if (normalized.includes("need") || normalized.includes("pending") || normalized.includes("wait")) return "status-wait";
  if (normalized.includes("fail") || normalized.includes("reject") || normalized.includes("cancel")) return "status-error";
  return "status-neutral";
}

function provenanceEntries(mode: AppState["providerMode"]) {
  if (typeof mode === "string" && mode) {
    return [
      ["Catalog", mode],
      ["Evidence", mode],
      ["Browser", mode],
      ["Payment", mode],
    ];
  }
  if (mode && typeof mode === "object") {
    return ["catalog", "evidence", "browser", "payment"].map((key) => {
      const value = mode[key];
      return [key[0].toUpperCase() + key.slice(1), typeof value === "string" ? value : "Not reported"];
    });
  }
  return [
    ["Catalog", "Not reported"],
    ["Evidence", "Not reported"],
    ["Browser", "Not reported"],
    ["Payment", "Not reported"],
  ];
}

function providerValue(mode: AppState["providerMode"], key: string) {
  if (typeof mode === "string") return mode;
  if (mode && typeof mode === "object" && typeof mode[key] === "string") return mode[key] as string;
  return "not reported";
}

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
      if (result.error) throw new Error(result.error.message || "Authentication failed.");
      setPassword("");
      await onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="auth-layout" aria-label="Demo account">
      <div className="auth-story">
        <span className="section-index">THE DEMO JOURNEY</span>
        <h2>Small steps, a reward you chose.</h2>
        <p>Start with one qualifying day. Choose a demo reward, set a clear rule, approve a maximum spend, and submit your notes.</p>
        <ol className="journey-list">
          <li><span>01</span> Pick a reward from the controlled demo store</li>
          <li><span>02</span> Set the goal and approve a bounded instruction</li>
          <li><span>03</span> Submit proof and see what the reviewer decided</li>
          <li><span>04</span> See whether the server permits the Sandbox purchase</li>
        </ol>
      </div>
      <div className="card auth-card">
        <div className="auth-tabs" role="group" aria-label="Account action">
          <button type="button" aria-pressed={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
          <button type="button" aria-pressed={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
        </div>
        <h2>{mode === "signup" ? "Try the sandbox demo" : "Welcome back"}</h2>
        <p className="muted">This account is for the local hackathon demonstration.</p>
        <form onSubmit={submit} className="stack-form">
          {mode === "signup" && (
            <label>Display name
              <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" minLength={2} required placeholder="Your name" />
            </label>
          )}
          <label>Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required placeholder="you@example.com" />
          </label>
          <label>Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} required placeholder="At least 8 characters" />
          </label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="button button-primary button-wide" disabled={pending} type="submit">
            {pending ? "Working…" : mode === "signup" ? "Create demo account" : "Sign in"}
          </button>
        </form>
      </div>
    </section>
  );
}

export function RewardLoopApp() {
  const { data: session, isPending: sessionPending, refetch: refetchSession } = authClient.useSession();
  const userId = session?.user?.id;
  const [state, setState] = useState<AppState | null>(null);
  const [loadingState, setLoadingState] = useState(false);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [selectedSku, setSelectedSku] = useState("");
  const [alternativeSkus, setAlternativeSkus] = useState<string[]>([]);
  const [goalTitle, setGoalTitle] = useState("Complete a focused study session");
  const [rubric, setRubric] = useState("Submit at least three specific notes about what you learned or practiced today.");
  const [timeZone, setTimeZone] = useState("America/New_York");
  const [startDate, setStartDate] = useState(() => inTimeZone("America/New_York"));
  const [endDate, setEndDate] = useState(() => addDays(inTimeZone("America/New_York"), 30));
  const [requiredDays, setRequiredDays] = useState(1);
  const [capDollars, setCapDollars] = useState("40.00");
  const [earliestDate, setEarliestDate] = useState(() => inTimeZone("America/New_York"));
  const [latestDate, setLatestDate] = useState(() => addDays(inTimeZone("America/New_York"), 30));
  const [notes, setNotes] = useState("");

  const refreshState = useCallback(async () => {
    setLoadingState(true);
    try {
      const next = await jsonRequest<AppState>("/api/state");
      setState(next);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your demo state.");
    } finally {
      setLoadingState(false);
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
  const selectedProduct = useMemo(() => products.find((product) => productSku(product) === primarySku) || null, [products, primarySku]);
  const goalId = textField(goal, "id", "goalId");
  const acceptedDays = numberField(goal, "acceptedDays", "qualifyingDays", "progressDays") ?? 0;
  const targetDays = numberField(goal, "requiredDays") ?? requiredDays;
  const progress = goal ? Math.min(100, Math.round((acceptedDays / Math.max(targetDays, 1)) * 100)) : 0;
  const purchaseStatus = textField(purchase, "status", "state");
  const catalogProvider = providerValue(state?.providerMode || null, "catalog");
  const paymentProvider = textField(purchase, "receiptProvider") || providerValue(state?.providerMode || null, "payment");
  const hasSandboxPayment = paymentProvider.toLowerCase().includes("paypal") && paymentProvider.toLowerCase().includes("sandbox");
  const fixtureComplete = purchaseStatus.toUpperCase() === "CONFIRMED" && paymentProvider.toLowerCase() === "fixture";
  const displayedPurchaseStatus = fixtureComplete ? "Fixture simulation complete" : purchaseStatus;

  async function runAction(action: Exclude<BusyAction, null>, path: string, payload: Record<string, unknown>, success: string) {
    setBusy(action);
    setError("");
    setMessage("");
    try {
      await jsonRequest(path, { method: "POST", body: JSON.stringify(payload) });
      await refreshState();
      setMessage(success);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request did not complete.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function submitGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startDate >= endDate) { setError("The goal end date must be after its start date."); return; }
    try { new Intl.DateTimeFormat("en-US", { timeZone }).format(); }
    catch { setError("Enter a valid IANA timezone, such as America/New_York."); return; }
    await runAction("goal", "/api/goals", {
      title: goalTitle.trim(), rubric: rubric.trim(), timezone: timeZone.trim(),
      requiredDays, startDate, endDateExclusive: endDate,
    }, "Goal saved. Now approve the reward and maximum spend.");
  }

  async function submitPermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const totalCapMinor = dollarsToMinor(capDollars);
    if (totalCapMinor === null || totalCapMinor < 1) { setError("Enter a valid USD cap, such as 40.00."); return; }
    if (!goalId || !selectedSku) { setError("Choose a reward and save a goal first."); return; }
    if (earliestDate >= latestDate) { setError("The purchase-before date must be after the first allowed date."); return; }
    await runAction("permission", "/api/permissions", {
      goalId, primarySku: selectedSku, alternativeSkus, totalCapMinor, earliestDate, latestDate,
    }, "Permission saved. You can now submit proof for review.");
  }

  async function revokeCurrentPermission() {
    const permissionId = textField(permission, "id");
    if (!permissionId || !activePermission) return;
    await runAction("revoke", "/api/permissions/revoke", { permissionId },
      "Permission revoked. New purchases are blocked. A Sandbox request already in flight may still settle; check the receipt status.");
  }

  async function submitEvidence(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!goalId || !notes.trim()) { setError("Write your notes and save a goal first."); return; }
    const saved = await runAction("evidence", "/api/evidence", { goalId, notes: notes.trim() }, "Proof submitted. Refresh to follow its review and purchase status.");
    if (saved) setNotes("");
  }

  function chooseProduct(sku: string, priceMinor: number | null) {
    setSelectedSku(sku);
    setAlternativeSkus((current) => current.filter((item) => item !== sku));
    if (priceMinor !== null) setCapDollars(((priceMinor + 1000) / 100).toFixed(2));
  }

  function toggleAlternative(sku: string) {
    setAlternativeSkus((current) => current.includes(sku) ? current.filter((item) => item !== sku) : current.length < 3 ? [...current, sku] : current);
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <a href="#top" className="brand" aria-label="RewardLoop home"><span className="brand-mark">r<span>•</span></span><span>RewardLoop</span></a>
        <div className="header-actions">
          <span className="sandbox-pill"><span className="pill-dot" /> PayPal Sandbox demo</span>
          {userId && <button type="button" className="text-button" onClick={async () => { await authClient.signOut(); setState(null); setMessage(""); }}>Sign out</button>}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <span className="eyebrow"><span className="eyebrow-line" /> A better reason to keep going</span>
            <h1>Make the reward<br /><em>worth earning.</em></h1>
            <p>Choose something you want. Set a goal you can show progress on. When your proof meets the rule, RewardLoop checks the purchase you approved.</p>
            <div className="hero-tags"><span>Choose</span><span className="tag-arrow">→</span><span>Show up</span><span className="tag-arrow">→</span><span>Earn it</span></div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" />
            <div className="reward-note"><span className="note-small">YOUR NEXT REWARD</span><strong>Something<br />to look forward to.</strong><span className="note-underline" /></div>
            <div className="art-stamp">A little progress<br />adds up.</div>
          </div>
        </section>

        <div className="safety-banner" role="note">
          <span className="safety-icon" aria-hidden="true">✓</span>
          <p><strong>A simulated purchase, with real guardrails.</strong> No real charge, retailer order, or shipment occurs. A completed integration run uses PayPal Sandbox only.</p>
        </div>

        {sessionPending ? (
          <div className="loading-panel" role="status">Checking your demo session…</div>
        ) : !userId ? (
          <AuthPanel onAuthenticated={async () => { await refetchSession(); }} />
        ) : (
          <>
            <section className="workspace-heading">
              <div><span className="section-index">YOUR SPACE</span><h2>Welcome{session?.user?.name ? `, ${session.user.name.split(" ")[0]}` : ""}.</h2><p>Build one thoughtful reward, then follow each step.</p></div>
              <button type="button" className="button button-secondary" disabled={loadingState || busy !== null} onClick={() => void refreshState()}>{loadingState ? "Refreshing…" : "Refresh status"}</button>
            </section>

            {(error || message) && <div className={error ? "feedback feedback-error" : "feedback feedback-success"} role={error ? "alert" : "status"}>{error || message}</div>}

            <section className="steps" aria-label="Your progress">
              {[
                ["01", "Choose a reward", Boolean(primarySku)],
                ["02", "Set a goal", Boolean(goal)],
                ["03", "Approve a cap", activePermission],
                ["04", "Show progress", Boolean(purchaseStatus) || acceptedDays > 0],
              ].map(([number, label, done]) => (
                <div className={`step ${done ? "step-done" : ""}`} key={String(number)}><span className="step-number">{String(number)}</span><span>{String(label)}</span><span className="step-state" aria-label={done ? "Done" : "Not yet"}>{done ? "✓" : "○"}</span></div>
              ))}
            </section>

            <div className="workspace-grid" aria-busy={loadingState}>
              <div className="workspace-main">
                <CatalogDiscovery available={catalogProvider === "channel3"} />
                <section className="card section-card" aria-labelledby="reward-title">
                  <div className="card-heading"><div><span className="section-index">STEP 01 · REWARD</span><h2 id="reward-title">Pick something to earn</h2></div><span className="fixture-chip">Controlled demo catalog</span></div>
                  <p className="muted">These are app-owned demo items. No retailer receives an order. Catalog prices are indicative; the controlled store checks the final total.</p>
                  {products.length === 0 ? (
                    <div className="empty-state">No demo rewards are available yet. Check the local setup and refresh.</div>
                  ) : (
                    <div className="product-grid">
                      {products.map((product, index) => {
                        const sku = productSku(product);
                        const selected = primarySku === sku;
                        const price = productPrice(product);
                        const available = product.available !== false;
                        return (
                          <button type="button" key={sku || index} className={`product-card ${selected ? "selected" : ""}`} aria-pressed={selected} disabled={!sku || !available || Boolean(permission)} onClick={() => chooseProduct(sku, price)}>
                            <span className={`product-visual visual-${index % 4}`} aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><span className="visual-shape" /></span>
                            <span className="product-copy"><strong>{productTitle(product)}</strong><small>{textField(product, "description") || (available ? "Demo reward" : "Unavailable")}</small><span className="product-price">{money(price)} <span>{selected ? "Selected" : available ? "Choose reward" : "Unavailable"}</span></span></span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="card section-card" aria-labelledby="goal-title">
                  <div className="card-heading"><div><span className="section-index">STEP 02 · GOAL</span><h2 id="goal-title">Make it measurable</h2></div>{goal && <span className="complete-chip">Saved</span>}</div>
                  {goal ? (
                    <div className="saved-summary"><h3>{textField(goal, "title") || "Your goal"}</h3><p>{textField(goal, "rubric") || "Your evidence rule is saved."}</p><div className="summary-facts"><span>{acceptedDays} of {targetDays} qualifying days</span><span>{textField(goal, "timezone") || timeZone}</span><span className={statusClass(textField(goal, "status", "state"))}>{textField(goal, "status", "state") || "Active"}</span></div><div className="progress-track" role="progressbar" aria-valuenow={acceptedDays} aria-valuemin={0} aria-valuemax={targetDays} aria-label="Qualifying days"><span style={{ width: `${progress}%` }} /></div></div>
                  ) : (
                    <form onSubmit={submitGoal} className="stack-form">
                      <label>Goal title<input value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} required maxLength={120} /></label>
                      <label>What counts as proof?<textarea value={rubric} onChange={(event) => setRubric(event.target.value)} required rows={3} maxLength={1000} /><small>Describe something observable. Notes can show understanding; they cannot prove an unseen duration.</small></label>
                      <div className="form-row"><label>Qualifying days<input type="number" min="1" max="365" value={requiredDays} onChange={(event) => setRequiredDays(Number(event.target.value))} required /></label><label>Goal timezone<input list="timezones" value={timeZone} onChange={(event) => setTimeZone(event.target.value)} required /><datalist id="timezones"><option value="America/New_York" /><option value="America/Los_Angeles" /><option value="America/Chicago" /><option value="Asia/Kolkata" /><option value="UTC" /></datalist></label></div>
                      <div className="form-row"><label>Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label>End date (exclusive)<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} required /></label></div>
                      <button type="submit" className="button button-primary" disabled={busy !== null}>{busy === "goal" ? "Saving goal…" : "Save this goal"}</button>
                    </form>
                  )}
                </section>

                <section className="card section-card" aria-labelledby="permission-title">
                  <div className="card-heading"><div><span className="section-index">STEP 03 · PERMISSION</span><h2 id="permission-title">Set your boundaries</h2></div>{permission && <span className="complete-chip">{activePermission ? "Approved" : "Revoked"}</span>}</div>
                  {permission ? (
                    <div className="saved-summary">
                      <p><strong>{textField(permission, "primarySku") || "Selected demo reward"}</strong> {activePermission ? "is approved within the saved purchase rules." : "was covered by a permission that is now revoked."}</p>
                      <div className="summary-facts"><span>Maximum {money(numberField(permission, "totalCapMinor"))}</span><span>{textField(permission, "earliestDate")} to before {textField(permission, "latestDate")}</span><span className={statusClass(permissionStatus)}>{permissionStatus || "Active"}</span></div>
                      <p className="muted">{activePermission ? "Saving a PayPal wallet and approving a purchase are separate actions. This demo never enables live payments." : "New purchase attempts are blocked. An already started Sandbox payment may still settle; check the receipt status. This goal cycle cannot be approved again."}</p>
                      {activePermission && <button type="button" className="button button-secondary" disabled={busy !== null} onClick={() => void revokeCurrentPermission()}>{busy === "revoke" ? "Revoking…" : "Revoke purchase permission"}</button>}
                    </div>
                  ) : (
                    <form onSubmit={submitPermission} className="stack-form">
                      <p className="muted">The server will refuse any item, total, or date outside these choices. Select an exact primary reward above.</p>
                      <div className="permission-selection"><span>Primary reward</span><strong>{selectedProduct ? productTitle(selectedProduct) : "Choose a reward first"}</strong></div>
                      <fieldset className="alternatives"><legend>Allowed alternatives <span>(optional, up to 3)</span></legend>{products.filter((product) => productSku(product) !== selectedSku && productSku(product) && product.available !== false).map((product) => <label key={productSku(product)}><input type="checkbox" checked={alternativeSkus.includes(productSku(product))} disabled={!selectedSku || (alternativeSkus.length >= 3 && !alternativeSkus.includes(productSku(product)))} onChange={() => toggleAlternative(productSku(product))} /><span>{productTitle(product)} <small>{money(productPrice(product))}</small></span></label>)}</fieldset>
                      <div className="form-row"><label>All-in maximum (USD)<div className="input-prefix"><span>$</span><input inputMode="decimal" value={capDollars} onChange={(event) => setCapDollars(event.target.value)} required aria-label="All-in maximum in US dollars" /></div><small>Includes demo tax and shipping.</small></label><div className="form-help"><strong>One purchase only</strong><span>Permission is tied to this goal. Changing the rules requires approval again.</span></div></div>
                      <div className="form-row"><label>Earliest purchase date<input type="date" value={earliestDate} onChange={(event) => setEarliestDate(event.target.value)} required /></label><label>Purchase before<input type="date" value={latestDate} onChange={(event) => setLatestDate(event.target.value)} required /><small>This is the first date on which a purchase is not allowed.</small></label></div>
                      <button type="submit" className="button button-primary" disabled={!goalId || !selectedSku || busy !== null}>{busy === "permission" ? "Saving permission…" : "Approve these limits"}</button>
                    </form>
                  )}
                </section>

                <SandboxWallet />

                <FreshSandboxCheckout />

                <MockStoreSetup />

                <section className="card section-card" aria-labelledby="evidence-title">
                  <div className="card-heading"><div><span className="section-index">STEP 04 · PROGRESS</span><h2 id="evidence-title">Show what you did</h2></div></div>
                  <p className="muted">The reviewer checks your notes against the rule. Trusted code counts distinct qualifying days; one submission cannot create several days.</p>
                  <form onSubmit={submitEvidence} className="stack-form"><label>Today’s notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What did you study or practice? Share three specific takeaways…" rows={5} minLength={10} maxLength={5000} required /></label><button type="submit" className="button button-primary" disabled={!goalId || !activePermission || busy !== null}>{busy === "evidence" ? "Submitting…" : "Submit proof for review"}</button></form>
                  {evidence.length > 0 && <div className="review-history"><h3>Recent submissions</h3><ul>{evidence.slice(0, 4).map((item, index) => { const status = textField(item, "status", "decision") || "Pending"; return <li key={textField(item, "id") || index}><span className={`mini-status ${statusClass(status)}`}>{status}</span><span>{evidenceReason(item)}</span></li>; })}</ul></div>}
                </section>
              </div>

              <aside className="workspace-aside" aria-label="Demo status">
                <section className="card status-card"><span className="section-index">YOUR REWARD</span><div className="status-illustration" aria-hidden="true"><span className="status-illustration-ring" /><span>✦</span></div><h2>{selectedProduct ? productTitle(selectedProduct) : "Your reward goes here"}</h2><p>{selectedProduct ? "A demo-store item linked to your choice." : "Choose one of the demo rewards to get started."}</p><div className="status-divider" /><dl><div><dt>Goal progress</dt><dd>{goal ? `${acceptedDays} / ${targetDays} days` : "Not started"}</dd></div><div><dt>Approved cap</dt><dd>{permission ? money(numberField(permission, "totalCapMinor")) : "Not approved"}</dd></div><div><dt>Purchase</dt><dd>{displayedPurchaseStatus || "Not started"}</dd></div></dl></section>
                <section className="card provenance-card"><span className="section-index">INTEGRATION SETTINGS</span><h2>Provider access</h2><p>These settings show which services are configured. Search results, reviews, and receipts identify which provider actually handled each step.</p><dl>{provenanceEntries(state?.providerMode || null).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></section>
                <section className="card receipt-card"><span className="section-index">PURCHASE & RECEIPT</span>{fixtureComplete && <div className="fixture-receipt-label">Fixture only · No PayPal payment</div>}<h2>{displayedPurchaseStatus || "Waiting on progress"}</h2><p>{fixtureComplete ? "The controlled demo store completed a local simulation. No PayPal Sandbox order or capture was created." : purchase ? textField(purchase, "reason", "message") || "The purchase state is shown here after the backend checks it." : "When your goal qualifies, the server checks the saved limits before any Sandbox payment."}</p>{purchase && <dl><div><dt>Store browser</dt><dd>{textField(purchase, "browserProvider") || "Not prepared"}</dd></div><div><dt>Synthetic store order</dt><dd>{textField(purchase, "storeOrderId", "mockStoreOrderId") || "—"}</dd></div><div><dt>PayPal Sandbox order</dt><dd>{hasSandboxPayment ? textField(purchase, "paypalOrderId", "orderId") || "—" : "Not run"}</dd></div><div><dt>Sandbox capture</dt><dd>{hasSandboxPayment ? textField(purchase, "paypalCaptureId", "captureId") || "—" : "Not run"}</dd></div></dl>}<div className="receipt-disclaimer">No real charge · No retailer order · No shipment</div></section>
              </aside>
            </div>
          </>
        )}
      </main>
      <footer className="site-footer"><span>RewardLoop · PayPal AI Hackathon</span><span>Built for a safer, more intentional reward demo.</span></footer>
    </div>
  );
}
