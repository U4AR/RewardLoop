"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FreshStatus = {
  configured: boolean;
  environment: "sandbox";
  mode: "fresh_buyer_approval" | "not_selected";
  status: string;
  ready: boolean;
  pendingOrderId?: string;
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

const WAITING: Record<string, string> = {
  ARMED: "Getting your order ready…",
  QUEUED: "Getting your order ready…",
  PREPARED: "Getting your order ready…",
  RESERVED: "Getting your order ready…",
  QUALIFIED_WAITING_WINDOW: "Your purchase window hasn’t opened yet.",
  COMMITTING: "Confirming your payment with PayPal…",
  OUTCOME_UNKNOWN: "We’re checking the payment result with PayPal. Don’t pay again.",
  NEEDS_USER: "This purchase needs your attention. The price or cart may have changed.",
  STALE: "This order expired. Start the payment again.",
};

export function FreshSandboxCheckout({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<FreshStatus | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [returnedOrderId, setReturnedOrderId] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const changeRef = useRef(onChange);
  useEffect(() => { changeRef.current = onChange; }, [onChange]);

  const refresh = useCallback(async () => {
    try { setStatus(await request<FreshStatus>("/api/paypal/sandbox/fresh/status", "GET")); }
    catch { setStatus(null); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("paypal_fresh");
    if (outcome === "canceled") {
      setNotice("You cancelled on PayPal. Nothing was charged.");
    } else if (outcome === "approved") {
      const token = params.get("token");
      if (token && /^[A-Za-z0-9_-]{1,36}$/.test(token)) setReturnedOrderId(token);
      else setError("PayPal didn’t return a valid order. Nothing was charged.");
    }
  }, []);

  async function continueInSandbox() {
    setRedirecting(true); setError(""); setNotice("");
    try {
      const created = await request<{ orderId: string; approvalUrl?: string; alreadyApproved?: boolean }>(
        "/api/paypal/sandbox/fresh/order", "POST",
      );
      if (!created.orderId || !/^[A-Za-z0-9_-]{1,36}$/.test(created.orderId)) throw new Error("ORDER_ID_INVALID");
      if (created.alreadyApproved) {
        setReturnedOrderId(created.orderId);
        return;
      }
      if (!created.approvalUrl) throw new Error("APPROVAL_LINK_MISSING");
      const approval = new URL(created.approvalUrl);
      if (approval.origin !== "https://www.sandbox.paypal.com" || approval.pathname !== "/checkoutnow" ||
          approval.searchParams.getAll("token").length !== 1 ||
          approval.searchParams.get("token") !== created.orderId) throw new Error("APPROVAL_LINK_INVALID");
      window.location.assign(approval.toString());
    } catch {
      setError("Couldn’t open PayPal. Wait a moment, then try again. You haven’t been charged.");
      await refresh();
      setRedirecting(false);
    }
  }

  async function completeReturnedCapture() {
    if (!returnedOrderId || status?.pendingOrderId !== returnedOrderId) return;
    setCapturing(true); setError(""); setNotice("");
    try {
      const result = await request<{ status: string }>("/api/paypal/sandbox/fresh/capture", "POST", { orderId: returnedOrderId });
      if (result.status !== "CONFIRMED") setNotice("Confirming with PayPal…");
      window.history.replaceState(null, "", window.location.pathname);
    } catch {
      setError("We couldn’t confirm the result yet. Don’t pay again; this page will update.");
    } finally {
      setCapturing(false);
      await refresh();
      changeRef.current?.();
    }
  }

  const mismatch = returnedOrderId && status?.ready && status.pendingOrderId !== returnedOrderId;
  const canCapture = returnedOrderId && status?.ready && status.pendingOrderId === returnedOrderId;

  return (
    <div className="checkout">
      {!status && <p className="waiting">Connecting to PayPal…</p>}
      {status && !status.ready && <p className="waiting">{WAITING[status.status] ?? "Getting your order ready…"}</p>}
      {status?.ready && (canCapture ? (
        <>
          <p className="checkout-ok">Approved on PayPal.</p>
          <button type="button" className="btn btn-primary btn-big" disabled={capturing} onClick={() => void completeReturnedCapture()}>
            {capturing ? "Completing payment…" : "Complete payment"}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-paypal btn-big" disabled={redirecting} onClick={() => void continueInSandbox()}>
          {redirecting ? "Opening PayPal…" : <>Pay with <b>PayPal</b></>}
        </button>
      ))}
      {mismatch && <p className="error" role="alert">That PayPal approval is for a different order. Nothing was charged.</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
