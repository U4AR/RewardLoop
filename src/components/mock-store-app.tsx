"use client";

import { useEffect, useState } from "react";

type StoreCart = {
  accountLabel: string;
  sku: string | null;
  destinationId: string;
  products: Array<{ sku: string; title: string; variant: string; seller: string; priceMinor: number; shippingMinor: number; taxMinor: number; available: boolean }>;
  syntheticOnly: true;
  checkoutEnabled: false;
  shipment: false;
};

const card: React.CSSProperties = { maxWidth: 640, margin: "3rem auto", padding: "2rem", background: "#fffaf1", border: "1px solid #dacbb1", borderRadius: 16, color: "#26312c", fontFamily: "system-ui, sans-serif" };
const field: React.CSSProperties = { width: "100%", padding: "0.75rem", border: "1px solid #9caa9e", borderRadius: 8, font: "inherit" };
const button: React.CSSProperties = { padding: "0.75rem 1.25rem", border: 0, borderRadius: 8, background: "#1e5c4a", color: "white", fontWeight: 700, cursor: "pointer" };

export function MockStoreApp() {
  const [cart, setCart] = useState<StoreCart | null>(null);
  const [code, setCode] = useState("");
  const [sku, setSku] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function loadCart() {
    const response = await fetch("/api/store/cart", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as StoreCart;
    setCart(data);
    setSku(data.sku ?? data.products[0]?.sku ?? "");
  }

  useEffect(() => { void loadCart(); }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setupCode: code.trim() }) });
      if (!response.ok) throw new Error("Code expired or invalid. Request a fresh code in RewardLoop.");
      setCode("");
      await loadCart();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Store sign-in failed"); }
    finally { setBusy(false); }
  }

  async function saveCart(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/store/cart", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sku, destinationId: "demo-us-address" }) });
      if (!response.ok) throw new Error("The synthetic cart could not be saved.");
      setCart(await response.json() as StoreCart);
      setMessage("Synthetic cart saved. Return to RewardLoop and choose Use saved cart for this reward.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cart save failed"); }
    finally { setBusy(false); }
  }

  return <main style={{ minHeight: "100vh", background: "#f4efe5", padding: "1rem" }}>
    <div style={card}>
      <p style={{ color: "#8a4a25", fontWeight: 800, letterSpacing: ".08em", textTransform: "uppercase" }}>RewardLoop Demo Store · Simulated</p>
      <h1 style={{ fontSize: "2rem", marginBottom: ".5rem" }}>Prepare your reward cart</h1>
      <p>This is a controlled mock store for the PayPal AI Hackathon. No retailer receives an order, no item ships, and no payment happens here.</p>
      {!cart ? <form onSubmit={(event) => void login(event)}>
        <label htmlFor="store-code" style={{ display: "block", marginBottom: ".5rem", fontWeight: 600 }}>One-time synthetic store code</label>
        <input id="store-code" style={field} value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" required />
        <button style={{ ...button, marginTop: "1rem" }} disabled={busy}>Sign in to demo store</button>
      </form> : <form onSubmit={(event) => void saveCart(event)}>
        <p><strong>Signed in as:</strong> {cart.accountLabel}</p>
        <label htmlFor="demo-sku" style={{ display: "block", marginBottom: ".5rem", fontWeight: 600 }}>Synthetic demo product</label>
        <select id="demo-sku" style={field} value={sku} onChange={(event) => setSku(event.target.value)}>
          {cart.products.map((product) => <option key={product.sku} value={product.sku}>{product.title} · {product.variant} · ${(product.priceMinor / 100).toFixed(2)}{product.available ? "" : " · unavailable"}</option>)}
        </select>
        <p><strong>Fictional destination:</strong> Demo US Address (no real delivery)</p>
        <button style={button} disabled={busy || !sku}>Save synthetic cart</button>
        <p><strong>Saved cart:</strong> {cart.sku ? cart.products.find((product) => product.sku === cart.sku)?.title ?? cart.sku : "Empty"}</p>
      </form>}
      {message && <p role="status" style={{ marginTop: "1rem" }}>{message}</p>}
    </div>
  </main>;
}
