"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

const BIND_ERRORS: Record<string, string> = {
  CART_OUTSIDE_PERMISSION: "The item in your cart isn’t the one you approved. Add the approved item instead.",
  CART_ALREADY_BOUND: "A different cart is already linked to this reward.",
  PURCHASE_ALREADY_STARTED: "This purchase has already started.",
  NO_ACTIVE_REWARD: "Approve your spending limit first.",
  REWARD_CHANGED: "Your reward changed. Reload and try again.",
};

function isValidSetup(body: unknown): body is SetupCode {
  return Boolean(body && typeof body === "object" &&
    "storeSessionId" in body && typeof body.storeSessionId === "string" &&
    "setupCode" in body && typeof body.setupCode === "string" &&
    "storeUrl" in body && typeof body.storeUrl === "string" &&
    "expiresAt" in body && typeof body.expiresAt === "string" && Number.isFinite(Date.parse(body.expiresAt)) &&
    "syntheticOnly" in body && body.syntheticOnly === true);
}

export function MockStoreSetup({ sku, onLinked }: { sku: string; onLinked?: () => void }) {
  const [issue, setIssue] = useState<SetupCode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [bound, setBound] = useState(false);
  const [kernel, setKernel] = useState<KernelStatus | null>(null);
  const binding = useRef(false);
  const linkedRef = useRef(onLinked);
  useEffect(() => { linkedRef.current = onLinked; }, [onLinked]);

  const loadKernelStatus = useCallback(async () => {
    const response = await fetch("/api/mock-store/kernel-cart", { credentials: "same-origin", cache: "no-store" });
    if (response.ok) setKernel(await response.json() as KernelStatus);
  }, []);

  useEffect(() => { void loadKernelStatus(); }, [loadKernelStatus]);
  useEffect(() => {
    if (kernel?.status === "BOUND" || kernel?.verified) linkedRef.current?.();
    if (kernel?.status !== "PENDING" && kernel?.status !== "RUNNING") return;
    const timer = window.setInterval(() => { void loadKernelStatus(); }, 4000);
    return () => window.clearInterval(timer);
  }, [kernel?.status, kernel?.verified, loadKernelStatus]);

  // After the shop opens, link the cart as soon as it is saved there.
  useEffect(() => {
    if (!issue || bound) return;
    const tryBind = async () => {
      if (binding.current) return;
      binding.current = true;
      try {
        const response = await fetch("/api/mock-store/bind-cart", {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storeSessionId: issue.storeSessionId }),
        });
        const body: unknown = await response.json().catch(() => null);
        if (response.ok) { setBound(true); setError(""); linkedRef.current?.(); return; }
        const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "";
        if (code && code !== "CART_NOT_READY") setError(BIND_ERRORS[code] ?? "Couldn’t link your cart. Try again.");
      } finally { binding.current = false; }
    };
    const timer = window.setInterval(() => { void tryBind(); }, 2000);
    const expiry = window.setTimeout(() => { setIssue(null); setError("The shop link expired. Open the shop again."); },
      Math.max(0, Date.parse(issue.expiresAt) - Date.now()));
    return () => { window.clearInterval(timer); window.clearTimeout(expiry); };
  }, [issue, bound]);

  async function openShop() {
    const shopWindow = window.open("about:blank", "_blank");
    setPending(true);
    setError("");
    setBound(false);
    try {
      const response = await fetch("/api/mock-store/setup-code", { method: "POST", credentials: "same-origin", cache: "no-store" });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok || !isValidSetup(body)) throw new Error("SETUP_FAILED");
      setIssue(body);
      const target = `${body.storeUrl}#code=${encodeURIComponent(body.setupCode)}&sku=${encodeURIComponent(sku)}`;
      if (shopWindow) shopWindow.location.href = target;
      else window.open(target, "_blank");
    } catch {
      shopWindow?.close();
      setError("Couldn’t open the shop. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function prepareWithKernel() {
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/mock-store/kernel-cart", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        headers: { "content-type": "application/json" }, body: "{}",
      });
      if (!response.ok) throw new Error("KERNEL_FAILED");
      await loadKernelStatus();
    } catch {
      setError("The shopping agent couldn’t start. Open the shop yourself instead.");
    } finally { setPending(false); }
  }

  const kernelBusy = kernel?.status === "PENDING" || kernel?.status === "RUNNING";

  return (
    <div className="shop-step">
      {bound ? (
        <p className="checkout-ok">In your cart.</p>
      ) : issue ? (
        <div className="waiting-box">
          <span className="spinner" aria-hidden="true" />
          <div>
            <strong>Waiting for your cart…</strong>
            <span>Click <em>Add to cart</em> in the shop tab. This page updates by itself.</span>
          </div>
          <button type="button" className="link-btn" onClick={() => void openShop()}>Reopen shop</button>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="btn btn-primary btn-big" disabled={pending || !sku} onClick={() => void openShop()}>
            {pending ? "Opening…" : "Open the shop"}
          </button>
          {kernel?.available && (
            <button type="button" className="btn btn-ghost" disabled={pending || kernelBusy} onClick={() => void prepareWithKernel()}>
              {kernelBusy ? "Agent is adding it…" : "Let an agent add it"}
            </button>
          )}
        </div>
      )}
      {kernel?.status === "FAILED" && !bound && <p className="error" role="alert">The shopping agent couldn’t add it. Open the shop yourself instead.</p>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
