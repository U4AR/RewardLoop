"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type FreshStatus = {
  configured: boolean;
  environment: "sandbox";
  mode: "fresh_buyer_approval" | "not_selected";
  status: string;
  ready: boolean;
  clientId?: string;
  merchantId?: string;
};

async function request<T>(path: string, method: "GET" | "POST", body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store",
    ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) } : {}),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object") throw new Error("SANDBOX_REQUEST_FAILED");
  if ("error" in data && typeof data.error === "string") throw new Error(data.error);
  return data as T;
}

export function FreshSandboxCheckout() {
  const [status, setStatus] = useState<FreshStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const rendered = useRef(false);
  const refresh = useCallback(async () => {
    try { setStatus(await request<FreshStatus>("/api/paypal/sandbox/fresh/status", "GET")); }
    catch { setStatus(null); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => { if (!status?.ready) rendered.current = false; }, [status?.ready]);

  async function renderButtons() {
    if (!status?.ready || rendered.current || !window.paypalFresh?.Buttons) return;
    rendered.current = true;
    try {
      await window.paypalFresh.Buttons({
        createOrder: async () => {
          setError(""); setNotice("");
          const created = await request<{ orderId: string }>("/api/paypal/sandbox/fresh/order", "POST");
          if (!created.orderId) throw new Error("ORDER_ID_MISSING");
          return created.orderId;
        },
        onApprove: async ({ orderID }: { orderID: string }) => {
          if (!orderID) { setError("PayPal did not return an order ID. No capture was requested."); return; }
          try {
            const result = await request<{ status: string }>("/api/paypal/sandbox/fresh/capture", "POST", { orderId: orderID });
            setNotice(result.status === "CONFIRMED"
              ? "PayPal Sandbox capture confirmed for the synthetic demo reward."
              : "Sandbox payment status is being checked. Refresh before taking another action.");
            await refresh();
          } catch {
            setError("The Sandbox capture result is uncertain. Refresh the receipt status; do not start another payment.");
            await refresh();
          }
        },
        onCancel: () => setNotice("Sandbox buyer approval was canceled. No capture was requested."),
        onError: () => setError("The PayPal Sandbox approval window could not complete. Check the purchase status before retrying."),
      }).render("#fresh-sandbox-buttons");
    } catch {
      rendered.current = false;
      setError("The PayPal Sandbox approval button could not be shown.");
    }
  }

  const sdkUrl = status?.ready && status.clientId && status.merchantId
    ? `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(status.clientId)}&merchant-id=${encodeURIComponent(status.merchantId)}&currency=USD&intent=capture&components=buttons`
    : null;

  return (
    <section className="card section-card wallet-card" aria-labelledby="fresh-checkout-title">
      <div className="card-heading"><div><span className="section-index">FRESH BUYER APPROVAL · SANDBOX ONLY</span><h2 id="fresh-checkout-title">Approve the test purchase</h2></div><span className="fixture-chip">PayPal Sandbox</span></div>
      <p className="muted">If saving a wallet is unavailable, the test buyer can approve this one synthetic reward in PayPal Sandbox after the goal qualifies. A new approval is required for each purchase. This fallback is implemented but has not yet been verified with the project&apos;s Sandbox account.</p>
      {status?.mode === "fresh_buyer_approval" && !status.ready && <p className="wallet-status">Current purchase state: {status.status}. The approval button appears when model-reviewed progress qualifies and the approved date window opens.</p>}
      {!status && <p className="wallet-status">Checking Sandbox checkout availability…</p>}
      {status?.ready && <><div id="fresh-sandbox-buttons" className="paypal-buttons" aria-label="PayPal Sandbox buyer approval" />{sdkUrl && <Script src={sdkUrl} strategy="afterInteractive" data-namespace="paypalFresh" onReady={() => void renderButtons()} onError={() => setError("The official PayPal Sandbox script could not load.")} />}</>}
      {notice && <p className="wallet-notice" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      <button type="button" className="button button-secondary" onClick={() => void refresh()}>Refresh Sandbox status</button>
    </section>
  );
}
