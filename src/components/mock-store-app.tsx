"use client";

import { useEffect, useRef, useState } from "react";

type StoreCart = {
  accountLabel: string;
  sku: string | null;
  destinationId: string;
  products: Array<{ sku: string; title: string; variant: string; seller: string; priceMinor: number; shippingMinor: number; taxMinor: number; available: boolean }>;
  syntheticOnly: true;
  checkoutEnabled: false;
  shipment: false;
};

const ART: Record<string, string> = { "focus-timer-cream": "⏱", "study-lamp-sage": "💡", "notebook-set-blue": "📓" };
const dollars = (minor: number) => `$${(minor / 100).toFixed(2)}`;

export function MockStoreApp() {
  const [cart, setCart] = useState<StoreCart | null>(null);
  const [code, setCode] = useState("");
  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState(false);
  const [message, setMessage] = useState("");
  const wanted = useRef("");

  async function loadCart() {
    const response = await fetch("/api/store/cart", { cache: "no-store" });
    if (!response.ok) return false;
    const data = await response.json() as StoreCart;
    setCart(data);
    setSku(wanted.current && data.products.some((item) => item.sku === wanted.current) ? wanted.current : data.sku ?? data.products[0]?.sku ?? "");
    return true;
  }

  async function signIn(setupCode: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupCode: setupCode.trim() }) });
      if (!response.ok) throw new Error("This shop link has expired. Open the shop again from RewardLoop.");
      setCode("");
      await loadCart();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t open your cart."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const linkCode = params.get("code");
    wanted.current = params.get("sku") ?? "";
    if (window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      if (linkCode) await signIn(linkCode);
      else await loadCart();
    })();
  }, []);

  async function addToCart() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku, destinationId: "demo-us-address" }) });
      if (!response.ok) throw new Error("Couldn’t add it to your cart. Try again.");
      setCart(await response.json() as StoreCart);
      setAdded(true);
      window.setTimeout(() => { window.close(); }, 1600);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Couldn’t add it to your cart."); }
    finally { setBusy(false); }
  }

  const item = cart?.products.find((product) => product.sku === sku) ?? null;

  return (
    <main className="shop">
      <header className="shop-bar"><span className="shop-logo">Corner Shop</span><span className="shop-tag">Demo store</span></header>
      {!cart ? (
        <form className="shop-panel" onSubmit={(event) => { event.preventDefault(); void signIn(code); }}>
          <h1>Open your cart</h1>
          <label htmlFor="store-code">Shop code from RewardLoop</label>
          <input id="store-code" value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required />
          <button className="btn btn-primary" disabled={busy}>{busy ? "Opening…" : "Open cart"}</button>
          {message && <p className="error" role="alert">{message}</p>}
        </form>
      ) : added ? (
        <section className="shop-panel shop-done">
          <span className="shop-check" aria-hidden="true">✓</span>
          <h1>Added to your cart</h1>
          <p>Head back to RewardLoop. It’s already updated.</p>
        </section>
      ) : (
        <section className="shop-panel">
          {item && (
            <div className="shop-item">
              <span className="shop-art" aria-hidden="true">{ART[item.sku] ?? "🎁"}</span>
              <div>
                <h1>{item.title}</h1>
                <p className="shop-variant">{item.variant}</p>
                <p className="shop-price">{dollars(item.priceMinor)}</p>
                <p className="shop-extra">+ {dollars(item.shippingMinor)} shipping, {dollars(item.taxMinor)} tax</p>
              </div>
            </div>
          )}
          {cart.products.length > 1 && !wanted.current && (
            <label className="shop-choose">Item
              <select value={sku} onChange={(event) => setSku(event.target.value)}>
                {cart.products.map((product) => <option key={product.sku} value={product.sku}>{product.title}, {product.variant}</option>)}
              </select>
            </label>
          )}
          <button type="button" className="btn btn-primary btn-big btn-wide" disabled={busy || !sku} onClick={() => void addToCart()}>{busy ? "Adding…" : "Add to cart"}</button>
          {message && <p className="error" role="alert">{message}</p>}
        </section>
      )}
    </main>
  );
}
