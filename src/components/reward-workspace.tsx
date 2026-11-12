"use client";

import { createAuthClient } from "better-auth/react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { NormalizedProduct } from "@/integrations/channel3";
import type { RetailerCheck } from "@/integrations/retailer-check";
import type { z } from "zod";
import type { cloudDecisionSchema } from "@/integrations/vertex-review";
import { normalizeWorkspace } from "./workspace-normalize";
import { ShoppingPanel } from "./shopping-panel";

const auth = createAuthClient();
type Review = z.infer<typeof cloudDecisionSchema> & { autoPurchase?: { started: boolean; state?: string; reason?: string } | null };
type Plan = {
  id: string; product_id: string; product: NormalizedProduct; offer_url: string; merchant: string;
  goal_title: string; rubric: string; required_days: number; accepted_days: number; recipient_name?: string | null; start_date: string;
  timezone: string; deadline: string; budget_minor: number; status: "active" | "archived";
  retailer_check: RetailerCheck | null; checkout_opened_at: string | null;
};
type Checkin = { id: string; plan_id: string; business_date: string; status: string; notes: string; review: Review | null; created_at: string; evidence_kind?: "text" | "photo" | "voice"; has_media?: boolean };
type Workspace = {
  user: { name: string; email: string }; plans: Plan[]; checkins: Checkin[];
  stats: { totalDays: number };
  services: { catalog: boolean; reviewer: boolean; browser: boolean; reviewerName: string };
};
type View = "overview" | "discover" | "rewards" | "activity";

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
    gift: <><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8c-7 0-7-6-3-5 2 0 3 5 3 5s1-5 3-5c4-1 4 5-3 5Z"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    external: <><path d="M14 3h7v7m0-7L10 14"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/><path d="m20 2 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z"/></>,
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    logout: <><path d="M10 4H4v16h6m4-4 4-4-4-4m-6 4h13"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}
function money(minor: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100); }
function dateLabel(value: string) { return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
function offerFor(product: NormalizedProduct) { return product.offers.find(o => o.availability !== "out_of_stock") ?? product.offers[0]; }
function ProductImage({ product, className = "" }: { product: NormalizedProduct; className?: string }) {
  const [failed, setFailed] = useState(false);
  const url = product.images[0]?.url;
  return <div className={`rw-product-image ${className}`}>{url && !failed
    ? <img src={url} alt={product.images[0]?.altText || product.title} onError={() => setFailed(true)} loading="lazy" referrerPolicy="no-referrer"/>
    : <div className="rw-image-fallback"><Icon name="gift" size={40}/><span>Product image unavailable</span></div>}</div>;
}
async function request<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", cache: "no-store", credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || (response.status === 401 ? "Please sign in to continue." : "That did not go through. Please try again."));
  return data;
}
const action = <T,>(name: string, input: unknown) => request<T>("/api/workspace", { action: name, input });

function AccountForm({ onDone, signupEnabled }: { onDone: () => Promise<void>; signupEnabled: boolean }) {
  const [signup, setSignup] = useState(signupEnabled), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const values = new FormData(event.currentTarget);
    try {
      const email = String(values.get("email")), password = String(values.get("password"));
      const result = signup ? await auth.signUp.email({ email, password, name: String(values.get("name")) }) : await auth.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message || "Please check your account details.");
      await onDone();
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to sign in."); }
    finally { setBusy(false); }
  }
  return <div className="rw-auth-card" id="account"><div className="rw-eyebrow">YOUR NEXT CHAPTER</div><h2>{signup ? "Make room for progress." : "Welcome back."}</h2><p>Your goals, your rewards, your pace.</p>
    <form onSubmit={submit} className="rw-form">{signup && <label>Your name<input name="name" autoComplete="name" minLength={2} maxLength={80} required placeholder="How should we call you?"/></label>}
      <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@example.com"/></label>
      <label>Password<input name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={12} required placeholder="At least 12 characters"/></label>
      {error && <p className="rw-error" role="alert">{error}</p>}<button className="rw-button rw-button-dark" disabled={busy}>{busy ? "One moment…" : signup ? "Create your account" : "Sign in"}<Icon name="arrow"/></button>
    </form>{signupEnabled ? <button className="rw-text-button" onClick={() => { setSignup(!signup); setError(""); }}>{signup ? "Already a member? Sign in" : "New here? Create an account"}</button> : <p className="rw-field-help rw-invitation-note">This workspace is invitation-only. Sign in with your provided account.</p>}
  </div>;
}

function Landing({ onDone, signupEnabled }: { onDone: () => Promise<void>; signupEnabled: boolean }) {
  return <div className="rw-public"><header className="rw-public-header"><Logo/><a href="#how-it-works">How it works</a><a className="rw-public-signin" href="#account">Get started <Icon name="arrow" size={17}/></a></header>
    <main className="rw-public-main"><section className="rw-public-hero"><div><span className="rw-tag"><span className="rw-live-dot"/> A little intention. A real reward.</span><h1>Good things<br/>come to those<br/>who <em>show up.</em></h1><p>Turn something you want into a reason to keep going. Find a real reward, set a meaningful goal, and make a little progress every day.</p><a className="rw-button rw-button-dark" href="#account">Start your first goal <Icon name="arrow"/></a><div className="rw-hero-note"><Icon name="shield" size={17}/> You stay in control of every purchase.</div></div><AccountForm onDone={onDone} signupEnabled={signupEnabled}/></section>
    <section className="rw-how" id="how-it-works">{[
      ["01", "Find your reason.", "Discover real products from real retailers. Pick something worth working toward."],
      ["02", "Put in the work.", "Set your own criteria. Share your progress and get thoughtful feedback from RewardLoop AI."],
      ["03", "Enjoy what you earned.", "Approve exact limits once. When your goal is complete, a Kernel shopping agent prepares the checkout at the real retailer and stops for your review."],
    ].map(([n, title, text]) => <article key={n}><span>{n}</span><h3>{title}</h3><p>{text}</p></article>)}</section>
    <footer className="rw-public-footer"><Logo/><span>Built for follow-through.</span><a href="/about">How RewardLoop handles your data</a></footer></main></div>;
}
function Logo() { return <a className="rw-logo" href="/" aria-label="RewardLoop home"><span className="rw-logo-mark"><Icon name="check" size={20}/></span>rewardloop<span className="rw-logo-period">.</span></a>; }

function RewardCard({ plan, onOpen }: { plan: Plan; onOpen: (plan: Plan) => void }) {
  const earned = plan.accepted_days >= plan.required_days;
  const expired = new Date(`${plan.deadline}T23:59:59`) < new Date();
  return <button className="rw-reward-card" onClick={() => onOpen(plan)}><div className="rw-reward-visual"><ProductImage product={plan.product}/><span className={`rw-state-tag ${earned ? "rw-state-earned" : ""}`}>{earned ? "Earned" : expired ? "Goal ended" : "In progress"}</span></div>
    <div className="rw-reward-body">{plan.recipient_name && <span className="rw-gift-tag"><Icon name="gift" size={13}/> For {plan.recipient_name}</span>}<span className="rw-merchant">{plan.merchant}</span><h3>{plan.product.title}</h3><p>{plan.goal_title}</p><div className="rw-progress-track"><span style={{ width: `${Math.min(100, plan.accepted_days / plan.required_days * 100)}%` }}/></div><div className="rw-card-footer"><strong>{plan.accepted_days}<span> / {plan.required_days} days</span></strong><span>{earned ? "You did it" : `By ${dateLabel(plan.deadline)}`}</span></div></div>
  </button>;
}

export function RewardWorkspace() {
  const [state, setState] = useState<Workspace | null>(null), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState("");
  const [openAfterLoad, setOpenAfterLoad] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview"), [query, setQuery] = useState(""), [products, setProducts] = useState<NormalizedProduct[]>([]);
  const [searching, setSearching] = useState(false), [searched, setSearched] = useState(false), [searchError, setSearchError] = useState("");
  const [selectedProduct, setSelectedProduct] = useState<NormalizedProduct | null>(null), [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  useEffect(() => {
    if (!openAfterLoad || !state) return;
    const created = state.plans.find(plan => plan.id === openAfterLoad);
    if (created) { setSelectedPlan(created); setOpenAfterLoad(null); }
  }, [state, openAfterLoad]);
  const [toast, setToast] = useState("");
  const [signupEnabled, setSignupEnabled] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    try {
      setLoadError("");
      const response = await fetch("/api/workspace", { cache: "no-store", credentials: "same-origin" });
      const data = await response.json();
      if (response.status === 401) { setSignupEnabled(data.signupEnabled === true); setState(null); return; }
      if (!response.ok) throw new Error(data.message || "Your workspace is temporarily unavailable.");
      setState(normalizeWorkspace<Workspace>(data));
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Unable to load your workspace."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 5500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => { if (view === "discover") searchRef.current?.focus(); }, [view]);
  async function search(event?: FormEvent, preset?: string) {
    event?.preventDefault(); const text = (preset ?? query).trim(); if (text.length < 2) return;
    setQuery(text); setView("discover"); setSearching(true); setSearchError(""); setSearched(false);
    try {
      const result = await request<{ products: NormalizedProduct[] }>("/api/rewards/search", { query: text, limit: 6 });
      setProducts(result.products); setSearched(true);
    } catch (error) { setSearchError(error instanceof Error ? error.message : "Search unavailable."); setProducts([]); }
    finally { setSearching(false); }
  }
  function discover() { setView("discover"); }
  if (loading) return <div className="rw-loading"><Logo/><span className="rw-spinner"/><p>Getting your workspace ready…</p></div>;
  if (loadError) return <div className="rw-loading"><Logo/><h1>Let’s try that again.</h1><p role="alert">{loadError}</p><button className="rw-button rw-button-dark" onClick={() => void load()}>Reload workspace</button></div>;
  if (!state) return <Landing onDone={load} signupEnabled={signupEnabled}/>;
  const active = state.plans.filter(plan => plan.status === "active"), earned = state.plans.filter(plan => plan.accepted_days >= plan.required_days);
  const totalDays = state.stats.totalDays;  // normalized in load(); never undefined
  const firstName = state.user.name.split(" ")[0], nav = [["overview", "grid", "Overview"], ["discover", "search", "Discover rewards"], ["rewards", "gift", "My rewards"], ["activity", "clock", "Journal"]] as const;
  return <div className="rw-app"><aside className="rw-sidebar"><Logo/><div className="rw-workspace-label">YOUR WORKSPACE</div><nav aria-label="Main navigation">{nav.map(([key, icon, label]) => <button key={key} aria-label={label} title={label} className={view === key ? "is-active" : ""} onClick={() => setView(key)} aria-current={view === key ? "page" : undefined}><Icon name={icon}/><span>{label}</span>{key === "rewards" && active.length > 0 && <small>{active.length}</small>}</button>)}</nav>
    <div className="rw-sidebar-note"><span className="rw-note-icon"><Icon name="spark"/></span><strong>Small steps. Better habits.</strong><p>Your next reward starts with showing up today.</p><button onClick={discover}>Find your motivation <Icon name="arrow" size={16}/></button></div>
    <a className="rw-sidebar-about" href="/about"><Icon name="shield" size={17}/> Your data & your control</a><div className="rw-profile"><span className="rw-avatar">{firstName.slice(0, 1).toUpperCase()}</span><div><strong>{state.user.name}</strong><span>Personal workspace</span></div><button title="Sign out" aria-label="Sign out" onClick={async () => { await auth.signOut(); setState(null); }}><Icon name="logout" size={18}/></button></div></aside>
    <div className="rw-main"><header className="rw-topbar"><span>{nav.find(item => item[0] === view)?.[2]}</span><div><span className="rw-today">{new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span><span className="rw-avatar rw-avatar-small">{firstName.slice(0, 1).toUpperCase()}</span></div></header>
    <main className="rw-content">
      {view === "overview" && <><div className="rw-page-heading"><div><span className="rw-eyebrow">A LITTLE PROGRESS, EVERY DAY</span><h1>Good to see you, {firstName}<span className="rw-heading-dot">.</span></h1><p>Make today count. Your next reward is getting closer.</p></div><button className="rw-button rw-button-dark" onClick={discover}><Icon name="plus" size={18}/> New reward</button></div>
        {active.length > 0 ? <TodayBoard plans={active} checkins={state.checkins} onOpen={setSelectedPlan} onUpdate={load}/> : <section className="rw-motivation"><div className="rw-motivation-copy"><span className="rw-eyebrow">THE BEST KIND OF RETAIL THERAPY</span><h2>Want it.<br/>Work for it.<br/><em>Make it yours.</em></h2><p>Give your goals something to look forward to.<br/>Find a reward that means something to you.</p><button className="rw-button rw-button-light" onClick={discover}>Explore rewards <Icon name="arrow" size={18}/></button></div><div className="rw-motivation-art" aria-hidden="true"><div className="rw-orbit rw-orbit-one"/><div className="rw-orbit rw-orbit-two"/><div className="rw-ticket"><div className="rw-ticket-top"><Icon name="gift" size={34}/><span>YOUR NEXT<br/>GOOD THING</span></div><div className="rw-ticket-line"/><div className="rw-ticket-stamps"><span><Icon name="check"/></span><span><Icon name="check"/></span><span><Icon name="check"/></span><span className="rw-ticket-stamp-empty"><Icon name="spark"/></span></div><strong>Made possible by you.</strong><span className="rw-ticket-caption">ONE DAY AT A TIME</span></div><span className="rw-float-star">✳</span><div className="rw-progress-badge"><span><Icon name="check" size={15}/></span>Progress feels good.</div></div></section>}
        <section className="rw-stats" aria-label="Your progress"><div><span className="rw-stat-icon"><Icon name="gift"/></span><div><span>Active rewards</span><strong>{active.length}</strong></div></div><div><span className="rw-stat-icon rw-stat-green"><Icon name="check"/></span><div><span>Days of progress</span><strong>{totalDays}</strong></div></div><div><span className="rw-stat-icon rw-stat-gold"><Icon name="spark"/></span><div><span>Rewards earned</span><strong>{earned.length}</strong></div></div></section>
        <div className="rw-section-heading"><div><h2>Your goals in motion</h2><p>A little closer with every check-in.</p></div><button className="rw-text-button" onClick={() => setView("rewards")}>View all rewards <Icon name="arrow" size={17}/></button></div>
        {active.length ? <div className="rw-rewards-grid">{active.slice(0, 3).map(plan => <RewardCard key={plan.id} plan={plan} onOpen={setSelectedPlan}/>)}</div> : <EmptyState icon="gift" title="Your first reward is waiting." text="Find something you love. Give it a goal. We'll help you follow through." onClick={discover} button="Find my first reward"/>}
        <div className="rw-bottom-grid"><section className="rw-recent"><div className="rw-section-heading"><h2>From your journal</h2><button className="rw-text-button" onClick={() => setView("activity")}>See all</button></div>{state.checkins.length ? state.checkins.slice(0, 3).map(c => <ActivityRow key={c.id} checkin={c} plan={state.plans.find(p => p.id === c.plan_id)}/>) : <p className="rw-muted">Your story starts with the first check-in. We'll keep your progress here.</p>}</section><section className="rw-control-card"><Icon name="shield" size={24}/><h3>Your reward. Your call.</h3><p>Earn your reward, then let the agent validate checkout and make a PayPal Sandbox test payment. Retailer orders remain dry runs.</p><a href="/about">How it works <Icon name="arrow" size={16}/></a></section></div>
      </>}
      {view === "discover" && <><div className="rw-page-heading"><div><span className="rw-eyebrow">SOMETHING WORTH SHOWING UP FOR</span><h1>Find your next good thing<span className="rw-heading-dot">.</span></h1><p>Real products. Real retailers. A little extra motivation.</p></div><span className="rw-source-label"><span className="rw-live-dot"/> Product search by Channel3</span></div><form className="rw-search" onSubmit={event => void search(event)}><Icon name="search" size={22}/><input ref={searchRef} aria-label="Search products" value={query} onChange={e => setQuery(e.target.value)} minLength={2} maxLength={200} placeholder="What would you love to earn?" required/><button className="rw-button rw-button-dark" disabled={searching}>{searching ? "Searching…" : "Find rewards"}<Icon name="arrow" size={18}/></button></form><div className="rw-search-suggestions"><span>Try something for</span>{["A better desk", "Your next adventure", "A creative habit", "A little downtime"].map((label, index) => <button key={label} onClick={() => void search(undefined, ["ergonomic desk accessories", "hiking backpack", "watercolor painting set", "wireless headphones"][index])}>{label}<Icon name="arrow" size={13}/></button>)}</div>
        {searchError && <div className="rw-error-box" role="alert">{searchError}<button className="rw-text-button" onClick={() => void search()}>Try again</button></div>}
        {searching ? <div className="rw-products-grid" aria-label="Searching products" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div className="rw-product-skeleton" key={i}><div/><span/><span/></div>)}</div> : searched ? <><div className="rw-section-heading"><h2>{products.length} finds for you</h2><span className="rw-muted">USD · Item prices exclude shipping & tax</span></div>{products.length ? <div className="rw-products-grid">{products.map(product => { const offer = offerFor(product); return <article className="rw-product-card" key={product.sourceProductId}><ProductImage product={product}/><div className="rw-product-body"><span className="rw-merchant">{product.brands[0] || offer?.sourceMerchantDomain || "Retailer product"}</span><h3>{product.title}</h3><div className="rw-product-pricing"><strong>{offer ? money(offer.observedPriceMinor) : "Price unavailable"}</strong><span>{offer?.sourceMerchantDomain}</span></div><button className="rw-button rw-button-outline" disabled={!offer || offer.availability === "out_of_stock"} onClick={() => setSelectedProduct(product)}>Make it a reward <Icon name="plus" size={17}/></button></div></article>; })}</div> : <EmptyState icon="search" title="Nothing quite right, yet." text="Try a product name, a brand, or a different idea. Your next reward is out there."/>}</> : !searchError && <div className="rw-discover-intro"><div className="rw-discover-icon"><Icon name="search" size={36}/></div><h2>What’s on your wishlist?</h2><p>From everyday upgrades to something special.<br/>Search to discover current retailer offers.</p><span>Retailer prices and availability can change.</span></div>}
      </>}
      {view === "rewards" && <><div className="rw-page-heading"><div><span className="rw-eyebrow">YOUR REASONS TO KEEP GOING</span><h1>A wishlist with purpose<span className="rw-heading-dot">.</span></h1><p>Small commitments, good progress, things you’ll love.</p></div><button className="rw-button rw-button-dark" onClick={discover}><Icon name="plus" size={18}/> Add a reward</button></div>{active.length ? <div className="rw-rewards-grid">{active.map(plan => <RewardCard key={plan.id} plan={plan} onOpen={setSelectedPlan}/>)}</div> : <EmptyState icon="gift" title="Make your wishlist work for you." text="Choose your first reward and connect it to a goal you care about." onClick={discover} button="Explore rewards"/>}{state.plans.some(p => p.status === "archived") && <details className="rw-archived"><summary>Archived rewards</summary>{state.plans.filter(p => p.status === "archived").map(p => <p key={p.id}>{p.product.title} · {p.goal_title}</p>)}</details>}</>}
      {view === "activity" && <><div className="rw-page-heading"><div><span className="rw-eyebrow">YOUR HABIT JOURNAL</span><h1>Every day you showed up<span className="rw-heading-dot">.</span></h1><p>RewardLoop AI writes a short entry for every check-in, from your words, photos and voice notes.</p></div></div>{state.checkins.length ? <section className="rw-activity-list">{state.checkins.map(c => <ActivityRow key={c.id} checkin={c} plan={state.plans.find(p => p.id === c.plan_id)} expanded/>)}</section> : <EmptyState icon="clock" title="Your journal starts with your first check-in." text="Write, snap a photo or record a voice note. RewardLoop AI keeps the journal for you." onClick={() => setView("rewards")} button="Go to my rewards"/>}</>}
      <footer className="rw-app-footer"><span>Better habits. Thoughtful rewards.</span><a href="/about">Privacy & how it works</a></footer>
    </main></div>
    {selectedProduct && <CreatePlan product={selectedProduct} onClose={() => setSelectedProduct(null)} onSaved={async planId => { setSelectedProduct(null); await load(); setView("overview"); setOpenAfterLoad(planId); setToast("Your reward is ready. Set up the purchase once, then just keep the habit."); }}/>}
    {selectedPlan && <PlanDetail plan={state.plans.find(p => p.id === selectedPlan.id) ?? selectedPlan} checkins={state.checkins.filter(c => c.plan_id === selectedPlan.id)} onClose={() => setSelectedPlan(null)} onUpdate={load} onArchive={async () => { setSelectedPlan(null); await load(); setToast("Reward archived. Your progress stays in your activity."); }}/>}
    {toast && <div className="rw-toast" role="status"><Icon name="check"/>{toast}</div>}
  </div>;
}

function EmptyState({ icon, title, text, onClick, button }: { icon: string; title: string; text: string; onClick?: () => void; button?: string }) {
  return <section className="rw-empty"><span><Icon name={icon} size={28}/></span><h3>{title}</h3><p>{text}</p>{onClick && <button className="rw-button rw-button-outline" onClick={onClick}>{button}<Icon name="arrow" size={17}/></button>}</section>;
}
function ActivityRow({ checkin, plan, expanded }: { checkin: Checkin; plan?: Plan; expanded?: boolean }) {
  const accepted = checkin.status === "accepted", kind = checkin.evidence_kind ?? "text";
  const kindLabel = kind === "photo" ? "Photo check-in" : kind === "voice" ? "Voice check-in" : "Written check-in";
  const media = checkin.has_media ? `/api/workspace/media?id=${encodeURIComponent(checkin.id)}` : null;
  return <article className="rw-activity-row"><span className={`rw-activity-icon ${accepted ? "is-accepted" : ""}`}><Icon name={accepted ? "check" : "clock"} size={18}/></span><div>
    <strong>{checkin.review?.journalEntry && accepted ? checkin.review.journalEntry : accepted ? "A day of progress, earned." : checkin.status === "error" ? "Progress saved · review unavailable" : checkin.status === "pending" ? "Your review is in progress" : "A little more detail will help"}</strong>
    <p>{plan?.goal_title ?? "Goal check-in"} <span>· {kindLabel} · {dateLabel(checkin.created_at)}</span></p>
    {expanded && <>{media && kind === "photo" && <img className="rw-journal-photo" src={media} alt="Progress photo" loading="lazy"/>}{media && kind === "voice" && <audio className="rw-journal-audio" controls preload="none" src={media}/>}
      {checkin.notes && <blockquote>{checkin.notes}</blockquote>}
      {checkin.review && <div className="rw-review-feedback"><span>REWARDLOOP AI</span><p>{checkin.review.reason}</p>{checkin.review.missingRequirements.length > 0 && <ul>{checkin.review.missingRequirements.map(item => <li key={item}>{item}</li>)}</ul>}</div>}</>}
  </div></article>;
}
type Evidence = "text" | "photo" | "voice";
type Media = { mimeType: string; base64: string; url: string };

async function blobBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
/** Resizes a photo to at most 1600 px and re-encodes it as JPEG, which also drops camera metadata such as location. */
async function photoPayload(file: File): Promise<Media> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("encode")), "image/jpeg", 0.85));
  return { mimeType: "image/jpeg", base64: await blobBase64(blob), url: URL.createObjectURL(blob) };
}

function CheckinForm({ planId, busy, perform, onReviewed }: { planId: string; busy: string; perform: (name: string, fn: () => Promise<void>) => Promise<void>; onReviewed: (review: Review) => Promise<void> }) {
  const [kind, setKind] = useState<Evidence>("text"), [notes, setNotes] = useState(""), [media, setMedia] = useState<Media | null>(null);
  const [recording, setRecording] = useState(false), [seconds, setSeconds] = useState(0), [mediaError, setMediaError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null), timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearInterval(timer.current); recorder.current?.stream.getTracks().forEach(track => track.stop()); }, []);
  function choose(next: Evidence) { setKind(next); setMedia(null); setMediaError(""); }
  async function pickPhoto(file?: File) {
    if (!file) return; setMediaError("");
    try { setMedia(await photoPayload(file)); } catch { setMediaError("This photo could not be read. Try another one."); }
  }
  async function startRecording() {
    setMediaError(""); setMedia(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) ?? "";
      const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined), chunks: Blob[] = [];
      rec.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(track => track.stop()); if (timer.current) window.clearInterval(timer.current); setRecording(false);
        const blob = new Blob(chunks, { type: (rec.mimeType || "audio/webm").split(";")[0] });
        setMedia({ mimeType: blob.type, base64: await blobBase64(blob), url: URL.createObjectURL(blob) });
      };
      recorder.current = rec; rec.start(); setRecording(true); setSeconds(0);
      timer.current = window.setInterval(() => setSeconds(value => { if (value + 1 >= 120 && rec.state === "recording") rec.stop(); return value + 1; }), 1000);
    } catch { setMediaError("Allow microphone access to record a voice check-in."); }
  }
  const ready = kind === "text" ? notes.trim().length >= 30 : Boolean(media) && !recording;
  return <form className="rw-form rw-checkin-form" onSubmit={event => { event.preventDefault(); void perform("review", async () => {
    const result = await action<Review>("checkin", { planId, kind, notes, ...(kind !== "text" && media ? { media: { mimeType: media.mimeType, base64: media.base64 } } : {}) });
    setNotes(""); setMedia(null); await onReviewed(result); }); }}>
    <div className="rw-evidence-head"><span>Today’s check-in</span><div className="rw-evidence-tabs" role="tablist" aria-label="Type of check-in">{([["text", "Write"], ["photo", "Photo"], ["voice", "Voice"]] as const).map(([value, label]) =>
      <button key={value} type="button" role="tab" aria-selected={kind === value} className={kind === value ? "is-active" : ""} onClick={() => choose(value)}>{label}</button>)}</div></div>
    {kind === "text" && <label>What did you make progress on today?<textarea rows={6} value={notes} onChange={event => setNotes(event.target.value)} required minLength={30} maxLength={5000} placeholder="Show your work. Tell us what you learned, made, or improved, with concrete examples."/></label>}
    {kind === "photo" && <div className="rw-evidence-media">{media && <img src={media.url} alt="Your progress photo"/>}<label className="rw-button rw-button-outline rw-file-button">{media ? "Choose another photo" : "Add a photo of your progress"}<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={event => void pickPhoto(event.target.files?.[0])}/></label></div>}
    {kind === "voice" && <div className="rw-evidence-media">{recording
      ? <button type="button" className="rw-button rw-button-dark rw-record is-recording" onClick={() => { if (recorder.current?.state === "recording") recorder.current.stop(); }}><span className="rw-rec-dot"/>Stop recording · {seconds}s</button>
      : <button type="button" className="rw-button rw-button-outline rw-record" onClick={() => void startRecording()}>{media ? "Record again" : "Record a voice note"}</button>}
      {media && !recording && <audio controls src={media.url}/>}<p className="rw-field-help">Up to 2 minutes. Say what you did today.</p></div>}
    {kind !== "text" && <label>Add a note (optional)<textarea rows={2} value={notes} onChange={event => setNotes(event.target.value)} maxLength={5000} placeholder="Anything RewardLoop AI should know"/></label>}
    {mediaError && <p className="rw-error" role="alert">{mediaError}</p>}
    <div className="rw-checkin-meta"><span><Icon name="spark" size={15}/> Reviewed by RewardLoop AI</span>{kind === "text" && <span>{notes.length} / 5,000</span>}</div>
    <p className="rw-field-help">RewardLoop AI reviews your check-in and adds it to your habit journal. One accepted check-in per day counts toward this goal.</p>
    <button className="rw-button rw-button-dark" disabled={!!busy || !ready}>{busy === "review" ? "RewardLoop AI is reviewing your progress…" : "Review my progress"}<Icon name="arrow" size={18}/></button>
  </form>;
}

function todayIn(timezone: string) {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
  catch { return new Date().toISOString().slice(0, 10); }
}
function ProgressCalendar({ plan, checkins }: { plan: Plan; checkins: Checkin[] }) {
  const days: string[] = [], today = todayIn(plan.timezone);
  for (let d = new Date(`${plan.start_date}T12:00:00Z`), end = new Date(`${plan.deadline}T12:00:00Z`); d <= end && days.length < 35; d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
  const status = new Map<string, "done" | "tried">();
  for (const c of checkins) { const day = String(c.business_date).slice(0, 10); if (c.status === "accepted") status.set(day, "done"); else if (!status.has(day)) status.set(day, "tried"); }
  return <section className="rw-calendar" aria-label="Daily progress calendar"><div className="rw-calendar-head"><strong>Daily progress</strong><span>{plan.accepted_days} of {plan.required_days} {plan.required_days === 1 ? "day" : "days"}</span></div>
    <ol>{days.map(day => { const s = status.get(day), date = new Date(`${day}T12:00:00Z`);
      return <li key={day} className={[s ? `is-${s}` : "", day === today ? "is-today" : "", day > today ? "is-future" : ""].join(" ")} title={`${date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}${s === "done" ? " · progress accepted" : s === "tried" ? " · checked in" : ""}`}>
        <span>{date.toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" })}</span><b>{date.getUTCDate()}</b>{s === "done" && <Icon name="check" size={11}/>}</li>; })}</ol></section>;
}

function ReviewFeedback({ feedback, recipient }: { feedback: Review; recipient: string | null }) {
  return <div className={`rw-feedback ${feedback.decision === "accepted" ? "rw-feedback-accepted" : ""}`} role="status"><strong>{feedback.decision === "accepted" ? "That’s a day well earned." : "You’re on your way. A little more detail?"}</strong><p>{feedback.reason}</p>{feedback.missingRequirements.length > 0 && <ul>{feedback.missingRequirements.map(item => <li key={item}>{item}</li>)}</ul>}
      {feedback.decision === "accepted" && feedback.journalEntry && <p className="rw-journal-line"><Icon name="spark" size={14}/> Added to your journal: {feedback.journalEntry}</p>}
      {feedback.autoPurchase?.started && <p className="rw-auto-note"><Icon name="gift" size={15}/> Goal earned. RewardLoop AI is now buying {recipient ? `${recipient}’s gift` : "your reward"}, within the permission you set.</p>}
      {feedback.autoPurchase && !feedback.autoPurchase.started && feedback.autoPurchase.reason && <p className="rw-auto-note">{feedback.autoPurchase.reason}</p>}</div>;
}

function TodayBoard({ plans, checkins, onOpen, onUpdate }: { plans: Plan[]; checkins: Checkin[]; onOpen: (plan: Plan) => void; onUpdate: () => Promise<void> }) {
  const [openId, setOpenId] = useState<string | null>(null), [busy, setBusy] = useState(""), [error, setError] = useState(""), [feedback, setFeedback] = useState<Record<string, Review>>({});
  async function perform(name: string, callback: () => Promise<void>) { setBusy(name); setError(""); try { await callback(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete this step."); } finally { setBusy(""); } }
  const status = (plan: Plan) => {
    const today = todayIn(plan.timezone), mine = checkins.filter(c => c.plan_id === plan.id);
    const week = Array.from({ length: 7 }, (_, k) => { const d = new Date(`${today}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - (6 - k)); const day = d.toISOString().slice(0, 10);
      return { day, label: d.toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" }), done: mine.some(c => c.status === "accepted" && String(c.business_date).slice(0, 10) === day), today: day === today }; });
    return { week, doneToday: week[6].done, earned: plan.accepted_days >= plan.required_days };
  };
  const doneCount = plans.filter(plan => status(plan).doneToday || status(plan).earned).length;
  return <section className="rw-today-board" aria-labelledby="rw-today-title">
    <div className="rw-section-heading"><div><h2 id="rw-today-title">Today’s habits</h2><p>Check in with a quick note, a photo or your voice.</p></div><span className="rw-today-count">{doneCount} of {plans.length} done today</span></div>
    <div className="rw-habit-list">{plans.map(plan => { const st = status(plan), open = openId === plan.id && !st.doneToday && !st.earned;
      return <article key={plan.id} className={`rw-habit ${st.doneToday ? "is-done" : ""} ${open ? "is-open" : ""}`}>
        <div className="rw-habit-row">
          <button type="button" className="rw-habit-thumb" onClick={() => onOpen(plan)} aria-label={`Open ${plan.goal_title}`}><ProductImage product={plan.product}/></button>
          <div className="rw-habit-main"><button type="button" className="rw-habit-title" onClick={() => onOpen(plan)}>{plan.goal_title}</button>
            <span className="rw-habit-sub">{plan.recipient_name ? <><Icon name="gift" size={12}/> For {plan.recipient_name} · </> : null}{plan.product.title} · {plan.accepted_days} of {plan.required_days} days</span>
            <ol className="rw-habit-week" aria-label="This week">{st.week.map(d => <li key={d.day} className={`${d.done ? "is-done" : ""} ${d.today ? "is-today" : ""}`} title={d.day}><span>{d.label}</span></li>)}</ol></div>
          <div className="rw-habit-action">{st.earned ? <button type="button" className="rw-habit-earned" onClick={() => onOpen(plan)}><Icon name="gift" size={15}/> Earned</button>
            : st.doneToday ? <span className="rw-habit-done"><Icon name="check" size={15}/> Done today</span>
            : <button type="button" className="rw-button rw-button-dark" onClick={() => setOpenId(open ? null : plan.id)}>{open ? "Close" : "Check in"}</button>}</div>
        </div>
        {open && <div className="rw-habit-checkin"><CheckinForm planId={plan.id} busy={busy} perform={perform} onReviewed={async result => { setFeedback(f => ({ ...f, [plan.id]: result })); if (result.decision === "accepted") setOpenId(null); await onUpdate(); }}/></div>}
        {feedback[plan.id] && <ReviewFeedback feedback={feedback[plan.id]} recipient={plan.recipient_name ?? null}/>}
      </article>; })}</div>
    {error && <p className="rw-error" role="alert">{error}</p>}
  </section>;
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const el = dialog.current; el?.showModal(); return () => { el?.close(); }; }, []);
  return <dialog ref={dialog} className={`rw-modal ${wide ? "rw-modal-wide" : ""}`} onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }} aria-label={title}><div className="rw-modal-inner"><header className="rw-modal-header"><span className="rw-eyebrow">{title}</span><button aria-label="Close dialog" className="rw-icon-button" onClick={onClose}><Icon name="close"/></button></header>{children}</div></dialog>;
}
function CreatePlan({ product, onClose, onSaved }: { product: NormalizedProduct; onClose: () => void; onSaved: (planId: string) => Promise<void> }) {
  const offers = product.offers.filter(o => o.availability !== "out_of_stock"), [offerIndex, setOfferIndex] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [forWhom, setForWhom] = useState<"me" | "someone">("me");
  const selected = offers[offerIndex], deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try {
      const created = await action<{ id: string }>("create", { productId: product.sourceProductId, merchant: selected.sourceMerchantDomain, goalTitle: form.get("goal"), rubric: form.get("rubric"), recipientName: forWhom === "someone" ? String(form.get("recipient") ?? "").trim() || undefined : undefined,
        requiredDays: Number(form.get("days")), budgetMinor: Math.round(Number(form.get("budget")) * 100), deadline: form.get("deadline"), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
      await onSaved(created.id);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save your reward."); }
    finally { setBusy(false); }
  }
  return <Modal title="MAKE IT A REWARD" onClose={onClose} wide><div className="rw-create-grid"><div className="rw-create-product"><ProductImage product={product}/><span className="rw-merchant">{product.brands[0] || selected?.sourceMerchantDomain}</span><h2>{product.title}</h2><strong className="rw-large-price">{selected && money(selected.observedPriceMinor)}</strong><p>Current item price. Shipping and taxes are determined by the retailer.</p></div><form className="rw-form" onSubmit={submit}><h2>Give it a purpose.</h2><p className="rw-muted">What would make this reward feel earned?</p>{offers.length > 1 && <label>Retailer<select value={offerIndex} onChange={e => setOfferIndex(Number(e.target.value))}>{offers.map((offer, i) => <option key={offer.sourceUrl} value={i}>{offer.sourceMerchantDomain} · {money(offer.observedPriceMinor)}</option>)}</select></label>}
      <fieldset className="rw-for-whom"><legend>Who is this reward for?</legend><div className="rw-segment" role="radiogroup">
        <label className={forWhom === "me" ? "is-active" : ""}><input type="radio" name="for" value="me" checked={forWhom === "me"} onChange={() => setForWhom("me")}/>Me</label>
        <label className={forWhom === "someone" ? "is-active" : ""}><input type="radio" name="for" value="someone" checked={forWhom === "someone"} onChange={() => setForWhom("someone")}/>Someone I love</label></div>
        {forWhom === "someone" && <label>Their name<input name="recipient" required maxLength={60} placeholder="e.g. Mom"/></label>}
        <p className="rw-field-help">{forWhom === "someone" ? "Keep your habit going, and the reward goes to them." : "Your progress earns it for you."}</p></fieldset>
      <label>Your goal<input name="goal" required minLength={4} maxLength={120} placeholder="e.g. Build a daily writing practice"/></label><label>What should your progress show?<textarea name="rubric" rows={3} required minLength={20} maxLength={1200} placeholder="e.g. Share a paragraph I wrote, explain one edit I made, and what I learned."/></label><p className="rw-field-help">Be specific. RewardLoop AI checks your notes against these criteria. Notes alone cannot prove time spent or activities it cannot observe.</p><div className="rw-form-columns"><label>Days of progress<input name="days" type="number" defaultValue={5} min={1} max={60} required/></label><label>Complete by<input name="deadline" type="date" defaultValue={deadline} min={new Date().toISOString().slice(0, 10)} required/></label></div><label>Your total budget (USD)<input name="budget" type="number" step="0.01" min={selected ? (selected.observedPriceMinor / 100).toFixed(2) : 1} defaultValue={selected ? Math.ceil(selected.observedPriceMinor / 100 * 1.2) : 100} max={10000} required/></label><p className="rw-field-help">Allow room for shipping and tax. The shopping agent needs your separate approval, with a cap that includes shipping and tax, or you can buy it yourself.</p><label className="rw-consent"><input type="checkbox" required/> I agree to send my check-in notes to RewardLoop AI for review. Nothing is bought unless I separately approve the exact purchase.</label>{error && <p role="alert" className="rw-error">{error}</p>}<button className="rw-button rw-button-dark" disabled={busy || !selected}>{busy ? "Saving your reward…" : "Let’s make it happen"}<Icon name="arrow" size={18}/></button></form></div></Modal>;
}
function PlanDetail({ plan, checkins, onClose, onUpdate, onArchive }: { plan: Plan; checkins: Checkin[]; onClose: () => void; onUpdate: () => Promise<void>; onArchive: () => Promise<void> }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [feedback, setFeedback] = useState<Review | null>(null), [checkoutUrl, setCheckoutUrl] = useState(""), [shopRefresh, setShopRefresh] = useState(0);
  const earned = plan.accepted_days >= plan.required_days;
  async function perform(name: string, callback: () => Promise<void>) { setBusy(name); setError(""); try { await callback(); } catch (error) { setError(error instanceof Error ? error.message : "Unable to complete this step."); } finally { setBusy(""); } }
  return <Modal title="YOUR REWARD, IN PROGRESS" onClose={onClose} wide><div className="rw-detail-grid"><aside><ProductImage product={plan.product}/><span className="rw-merchant">{plan.merchant}</span><h2>{plan.product.title}</h2><div className="rw-detail-budget"><span>Your budget</span><strong>{money(plan.budget_minor)}</strong></div><div className="rw-detail-milestones"><span>{plan.accepted_days} of {plan.required_days} days earned</span><div className="rw-progress-track"><span style={{ width: `${Math.min(100, plan.accepted_days / plan.required_days * 100)}%` }}/></div><p>Complete by {dateLabel(plan.deadline)} · {plan.timezone.replace(/_/g, " ")}</p></div><button className="rw-text-button rw-archive-button" disabled={!!busy} onClick={() => void perform("archive", async () => { await action("archive", { planId: plan.id }); await onArchive(); })}>Archive this reward</button></aside><div><span className="rw-tag">{plan.recipient_name ? <><Icon name="gift" size={13}/> A gift for {plan.recipient_name}</> : earned ? "A commitment, kept." : "ONE DAY AT A TIME"}</span><h2>{earned ? "You’ve earned this." : plan.goal_title}</h2><p className="rw-detail-rubric">{plan.rubric}</p>
    <ProgressCalendar plan={plan} checkins={checkins}/>
    {!earned && checkins.some(c => c.status === "accepted" && String(c.business_date).slice(0, 10) === todayIn(plan.timezone))
      ? <p className="rw-done-today"><Icon name="check" size={16}/> Today counts. See you tomorrow.</p>
      : !earned && <CheckinForm planId={plan.id} busy={busy} perform={perform} onReviewed={async result => { setFeedback(result); await onUpdate(); setShopRefresh(n => n + 1); }}/>}
    {feedback && <ReviewFeedback feedback={feedback} recipient={plan.recipient_name ?? null}/>}
    <ShoppingPanel planId={plan.id} merchant={plan.merchant} productTitle={plan.product.title} recipient={plan.recipient_name ?? null} refreshKey={shopRefresh}/>
    <section className="rw-retailer-section"><div className="rw-section-heading"><h3>A fresh look before you buy.</h3><Icon name="globe"/></div><p>Kernel opens the public product page to check what the retailer currently shows. It never signs in, changes a cart, or places an order.</p><button className="rw-button rw-button-outline" disabled={!!busy} onClick={() => void perform("inspect", async () => { await action("inspect", { planId: plan.id }); await onUpdate(); })}>{busy === "inspect" ? "Checking retailer page…" : "Check retailer page"}<Icon name="external" size={16}/></button>{plan.retailer_check && <div className="rw-retailer-report"><strong>{plan.retailer_check.priceMinor !== null ? `${money(plan.retailer_check.priceMinor)} observed` : "Price could not be confirmed"}</strong><span>{plan.retailer_check.availability.replace(/_/g, " ")} · {dateLabel(plan.retailer_check.checkedAt)}</span><p>{plan.retailer_check.message}</p></div>}</section>
    {earned && <section className="rw-checkout-section"><Icon name="gift" size={26}/><h3>Prefer to buy it yourself?</h3><p>We’ll refresh the catalog offer and check your item budget. You’ll confirm the final total and pay directly at {plan.merchant}. If the retailer offers PayPal, you can choose it there.</p>{checkoutUrl ? <a className="rw-button rw-button-dark" href={checkoutUrl} target="_blank" rel="noopener noreferrer">Continue to {plan.merchant}<Icon name="external" size={17}/></a> : <button className="rw-button rw-button-dark" disabled={!!busy} onClick={() => void perform("checkout", async () => { const result = await action<{ url: string }>("checkout", { planId: plan.id }); setCheckoutUrl(result.url); await onUpdate(); })}>{busy === "checkout" ? "Refreshing your offer…" : "Unlock retailer checkout"}<Icon name="arrow" size={18}/></button>}<span>No purchase has been made by RewardLoop.</span></section>}
    {error && <p role="alert" className="rw-error rw-detail-error">{error}</p>}{checkins.length > 0 && <section className="rw-detail-history"><h3>Your check-ins</h3>{checkins.slice(0, 5).map(c => <ActivityRow key={c.id} checkin={c} plan={plan}/>)}</section>}
  </div></div></Modal>;
}
