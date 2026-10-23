"use client";

import { useState, type FormEvent } from "react";

type Offer = {
  sourceMerchantDomain: string;
  observedPriceMinor: number;
  availability: "in_stock" | "out_of_stock" | "unknown";
  condition: string | null;
};
type CatalogProduct = {
  source: "channel3";
  sourceProductId: string;
  title: string;
  brands: string[];
  selectedVariant: { options: Array<{ name: string; label: string }> };
  offers: Offer[];
  observedAt: string;
  discoveryOnlyReason: string | null;
};
type SearchResponse = { products: CatalogProduct[]; provenance: "channel3" };
type LookupResponse =
  | { status: "found"; product: CatalogProduct; provenance?: "channel3" }
  | { status: "unsupported"; reason?: string; provenance?: "channel3" };

function formatPrice(minor: number) {
  return Number.isSafeInteger(minor) && minor >= 0 ? `$${(minor / 100).toFixed(2)}` : "Price unavailable";
}

function displayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time not reported" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

async function catalogPost<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
    const code = typeof record.error === "string" ? record.error : "";
    if (code === "CHANNEL3_NOT_CONFIGURED") throw new Error("Channel3 access is not configured yet. The developer must add the server-side API key.");
    if (code === "AUTH_REQUIRED" || code === "UNAUTHENTICATED") throw new Error("Sign in again to use catalog discovery.");
    throw new Error(typeof record.message === "string" ? record.message : "Channel3 could not complete this request. Try again after checking provider access.");
  }
  return body as T;
}

export function CatalogDiscovery({ available }: { available: boolean }) {
  const [mode, setMode] = useState<"search" | "lookup">("search");
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [hasLiveResponse, setHasLiveResponse] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    setMessage("");
    setHasLiveResponse(false);
    setResults([]);
    try {
      if (mode === "search") {
        const response = await catalogPost<SearchResponse>("/api/rewards/search", { query: query.trim(), limit: 6 });
        setResults(response.products);
        setHasLiveResponse(response.provenance === "channel3");
        if (response.products.length === 0) setMessage("Channel3 returned no matching products. Try a more specific search.");
      } else {
        const response = await catalogPost<LookupResponse>("/api/rewards/lookup", { url: url.trim() });
        setHasLiveResponse(response.provenance === "channel3");
        if (response.status === "found") setResults([response.product]);
        else setMessage("Channel3 did not support or find that product URL.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Catalog discovery did not complete.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="card section-card catalog-card" aria-labelledby="catalog-title">
      <div className="card-heading"><div><span className="section-index">CATALOG DISCOVERY · OPTIONAL FOR THIS SLICE</span><h2 id="catalog-title">Explore a real reward</h2></div><span className={hasLiveResponse ? "complete-chip" : "fixture-chip"}>{hasLiveResponse ? "Live Channel3 response" : available ? "Channel3 key configured" : "Access pending"}</span></div>
      <p className="muted">Search or look up a product through Channel3. These are discovery references only. The working demo purchase uses an app-owned item in our controlled store; no source retailer gets an order.</p>
      <div className="catalog-mode" role="group" aria-label="Catalog discovery method"><button type="button" className={mode === "search" ? "active" : ""} aria-pressed={mode === "search"} onClick={() => { setMode("search"); setError(""); setMessage(""); }}>Search products</button><button type="button" className={mode === "lookup" ? "active" : ""} aria-pressed={mode === "lookup"} onClick={() => { setMode("lookup"); setError(""); setMessage(""); }}>Paste product URL</button></div>
      <form onSubmit={submit} className="catalog-form">
        {mode === "search" ? <label>What kind of reward are you looking for?<input value={query} onChange={(event) => setQuery(event.target.value)} minLength={2} maxLength={200} placeholder="A desk accessory for studying" required disabled={!available} /></label> : <label>Public product URL<input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://shop.example/product" required disabled={!available} /></label>}
        <button className="button button-secondary" type="submit" disabled={!available || pending}>{pending ? "Checking Channel3…" : mode === "search" ? "Search Channel3" : "Look up product"}</button>
      </form>
      {!available && <p className="catalog-availability">Channel3 developer access and its server-side API key are pending. Demo-store reward selection below remains available.</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {message && <p className="catalog-message" role="status">{message}</p>}
      {results.length > 0 && <div className="catalog-results" aria-live="polite">{results.map((product) => {
        const offer = product.offers[0];
        const variants = product.selectedVariant?.options?.map((option) => `${option.name}: ${option.label}`).join(" · ");
        return <article className="catalog-result" key={product.sourceProductId}><div className="catalog-result-top"><span className="catalog-source">Channel3 discovery</span><span>{displayDate(product.observedAt)}</span></div><h3>{product.title}</h3>{product.brands.length > 0 && <p className="catalog-brand">{product.brands.join(", ")}</p>}{variants && <p className="catalog-variant">{variants}</p>}<div className="catalog-offer"><strong>{offer ? formatPrice(offer.observedPriceMinor) : "No usable USD offer"}</strong><span>{offer ? `${offer.sourceMerchantDomain} · ${offer.availability.replaceAll("_", " ")}` : product.discoveryOnlyReason || "Discovery only"}</span></div><p className="catalog-disclaimer">Indicative external listing. RewardLoop cannot purchase this item from the source retailer.</p></article>;
      })}</div>}
    </section>
  );
}
