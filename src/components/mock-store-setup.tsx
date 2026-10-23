"use client";

import { useEffect, useState } from "react";

type SetupCode = {
  storeSessionId: string;
  setupCode: string;
  storeUrl: string;
  expiresAt: string;
  syntheticOnly: true;
};

type KernelStatus = {
  available: boolean;
  status: string;
  verified: boolean;
  error?: string | null;
};

function setupError(error: unknown): string {
  if (error instanceof Error && error.message === "STORE_NOT_CONFIGURED") {
    return "The separate synthetic store address is not configured yet.";
  }
  if (error instanceof Error && error.message === "INVALID_ORIGIN") {
    return "Open RewardLoop at its configured app address, then try again.";
  }
  return "Could not create a store setup code. Check the local store setup and try again.";
}

export function MockStoreSetup() {
  const [issue, setIssue] = useState<SetupCode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [bound, setBound] = useState(false);
  const [kernel, setKernel] = useState<KernelStatus | null>(null);

  async function loadKernelStatus() {
    const response = await fetch("/api/mock-store/kernel-cart", { credentials: "same-origin", cache: "no-store" });
    if (response.ok) {
      const current = await response.json() as KernelStatus;
      setKernel(current);
      if (current.verified) setNotice("Kernel verified and linked this exact synthetic cart in two separate browser sessions.");
      else if (current.status === "FAILED") setNotice("");
    }
  }

  useEffect(() => { void loadKernelStatus(); }, []);
  useEffect(() => {
    if (kernel?.status !== "PENDING" && kernel?.status !== "RUNNING") return;
    const timer = window.setInterval(() => { void loadKernelStatus(); }, 4000);
    return () => window.clearInterval(timer);
  }, [kernel?.status]);

  async function prepareWithKernel() {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/mock-store/kernel-cart", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: "{}",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" && "message" in body && typeof body.message === "string"
          ? body.message : "Kernel cart preparation could not start.";
        throw new Error(message);
      }
      await loadKernelStatus();
      setNotice("Kernel is preparing the cart in the controlled store and checking it in a second browser session.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kernel cart preparation could not start.");
    } finally { setPending(false); }
  }

  useEffect(() => {
    if (!issue) return;
    const delay = Math.max(0, Date.parse(issue.expiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      setIssue(null);
      setNotice("The setup code expired. Create a new one if needed.");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [issue]);

  async function createCode() {
    setPending(true);
    setError("");
    setNotice("");
    setIssue(null);
    setBound(false);
    try {
      const response = await fetch("/api/mock-store/setup-code", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "UNKNOWN";
        throw new Error(code);
      }
      if (!body || typeof body !== "object" ||
        !("storeSessionId" in body) || typeof body.storeSessionId !== "string" ||
        !("setupCode" in body) || typeof body.setupCode !== "string" ||
        !("storeUrl" in body) || typeof body.storeUrl !== "string" ||
        !("expiresAt" in body) || typeof body.expiresAt !== "string" ||
        !("syntheticOnly" in body) || body.syntheticOnly !== true ||
        !Number.isFinite(Date.parse(body.expiresAt))) {
        throw new Error("INVALID_SETUP_RESPONSE");
      }
      setIssue(body as SetupCode);
    } catch (cause) {
      setError(setupError(cause));
    } finally {
      setPending(false);
    }
  }

  async function bindCart() {
    if (!issue) return;
    setPending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/mock-store/bind-cart", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ storeSessionId: issue.storeSessionId }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "Save the synthetic cart and ensure it matches your approved reward.";
        throw new Error(message);
      }
      setBound(true);
      setNotice("This exact synthetic cart is now linked to your reward. Payment still requires the goal, quote, and PayPal Sandbox checks.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not link the synthetic cart.");
    } finally { setPending(false); }
  }

  return (
    <section className="card section-card mock-store-card" aria-labelledby="mock-store-title">
      <div className="card-heading"><div><span className="section-index">CONTROLLED STORE · SYNTHETIC ONLY</span><h2 id="mock-store-title">Open your demo store</h2></div><span className="fixture-chip">No real checkout</span></div>
      <p className="muted">Create a private, one-time code for this account. Enter it at the separate synthetic store to prepare a demo cart. Use only fictional destination details; no real retailer order or shipment is created.</p>
      {kernel?.available && <div className="mock-store-code">
        <p>Kernel can prepare the approved demo item at the separate public HTTPS store, then reopen it in a new browser session to verify the saved cart.</p>
        <button type="button" className="button button-secondary" disabled={pending || kernel.status === "PENDING" || kernel.status === "RUNNING" || kernel.status === "BOUND"}
          onClick={() => void prepareWithKernel()}>
          {kernel.status === "PENDING" || kernel.status === "RUNNING" ? "Kernel is preparing the cart…" : kernel.status === "BOUND" ? "Cart linked" : "Prepare cart with Kernel"}
        </button>
        {kernel.verified && <p role="status">Verified in two separate Kernel browser sessions and linked to this reward.</p>}
        {kernel.status === "FAILED" && <p role="alert">Kernel could not verify the cart ({kernel.error || "provider unavailable"}). You can retry or prepare it manually.</p>}
      </div>}
      <button type="button" className="button button-secondary" disabled={pending} onClick={() => void createCode()}>{pending ? "Creating code…" : issue ? "Create a new code" : "Create one-time store code"}</button>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {notice && <p className="catalog-message" role="status">{notice}</p>}
      {issue && <div className="mock-store-code" role="status"><div><span>One-time setup code</span><code>{issue.setupCode}</code></div><div><span>Configured synthetic store</span><a href={issue.storeUrl} target="_blank" rel="noopener noreferrer">{issue.storeUrl}</a></div><p>Use this code once within 10 minutes. It expires at {new Date(issue.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. It is shown only in this signed-in account and is not saved in this browser.</p><p>After saving a cart in the store, return here to link that exact cart to this reward.</p><button type="button" className="button button-secondary" disabled={pending || bound} onClick={() => void bindCart()}>{bound ? "Cart linked" : pending ? "Linking cart…" : "Use saved cart for this reward"}</button></div>}
    </section>
  );
}
