"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type WalletStatus = {
  status: "CONNECTED" | "NOT_CONNECTED";
  environment: "sandbox";
  configured: boolean;
};
type SdkToken = { clientId: string; merchantId: string; idToken: string };
type SetupToken = { setupToken: string; state: string; expiresAt: string };
type PayPalWalletButtonOptions = {
  createVaultSetupToken: () => Promise<string>;
  onApprove: (data: { vaultSetupToken: string }) => Promise<void>;
  onCancel: () => void;
  onError: (error: unknown) => void;
};
type PayPalCheckoutButtonOptions = {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel: () => void;
  onError: (error: unknown) => void;
};

declare global {
  interface Window {
    paypalWallet?: { Buttons: (options: PayPalWalletButtonOptions) => { render: (selector: string) => Promise<void> } };
    paypalFresh?: { Buttons: (options: PayPalCheckoutButtonOptions) => { render: (selector: string) => Promise<void> } };
  }
}

class WalletUiError extends Error {
  constructor(readonly code: string) { super(code); }
}

async function walletRequest<T>(path: string, method: "GET" | "POST" | "DELETE", body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result: unknown = await response.json().catch(() => null);
  if (result && typeof result === "object" && "error" in result && typeof result.error === "string") {
    throw new WalletUiError(result.error);
  }
  if (!response.ok) throw new WalletUiError(`HTTP_${response.status}`);
  return result as T;
}

function walletErrorText(error: unknown) {
  const code = error instanceof WalletUiError ? error.code : "UNKNOWN";
  switch (code) {
    case "PAYPAL_SANDBOX_NOT_CONFIGURED": return "PayPal Sandbox merchant access is not configured yet. The developer must finish the Sandbox account setup.";
    case "PAYPAL_ID_TOKEN_MISSING": return "PayPal did not return the short-lived setup token. Check the Sandbox app's Vault capability.";
    case "WALLET_ALREADY_CONNECTED": return "A Sandbox wallet is already saved for this demo account. Refresh the connection status.";
    case "WALLET_SETUP_INVALID_OR_CONSUMED": return "That approval session expired or was already used. Start a new setup after checking the saved connection.";
    case "PAYPAL_OUTCOME_UNKNOWN": return "PayPal's result is uncertain. Do not repeat the setup until the connection is checked.";
    case "PAYPAL_SANDBOX_ERROR": return "PayPal Sandbox declined this setup. Check the Sandbox merchant's Vault capability and try after it is resolved.";
    default: return "The Sandbox wallet action did not complete. Check the connection status before trying again.";
  }
}

export function SandboxWallet() {
  const [wallet, setWallet] = useState<WalletStatus | null>(null);
  const [sdk, setSdk] = useState<SdkToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<"starting" | "disconnecting" | "retrying" | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [outcomeUnknown, setOutcomeUnknown] = useState(false);
  const setupRef = useRef<SetupToken | null>(null);
  const renderedRef = useRef(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await walletRequest<WalletStatus>("/api/paypal/sandbox/connection", "GET");
      setWallet(result);
      setStatusUnavailable(false);
      if (result.status === "CONNECTED") setOutcomeUnknown(false);
      setError("");
    } catch (cause) {
      setStatusUnavailable(true);
      setError(walletErrorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function startSetup() {
    setAction("starting");
    setNotice("");
    setError("");
    setupRef.current = null;
    renderedRef.current = false;
    try {
      const result = await walletRequest<SdkToken>("/api/paypal/sandbox/sdk-token", "POST");
      if (!result.clientId || !result.merchantId || !result.idToken) throw new WalletUiError("PAYPAL_ID_TOKEN_MISSING");
      setSdk(result);
      setNotice("Approve saving your test buyer wallet in the official PayPal Sandbox window. No purchase happens during setup.");
    } catch (cause) {
      setError(walletErrorText(cause));
    } finally {
      setAction(null);
    }
  }

  async function disconnect() {
    setAction("disconnecting");
    setNotice("");
    setError("");
    try {
      const result = await walletRequest<{ status: "DISCONNECTED"; providerDeletion: "CONFIRMED" | "PENDING" | "NOT_NEEDED" }>("/api/paypal/sandbox/connection", "DELETE");
      setSdk(null);
      await refresh();
      setNotice(result.providerDeletion === "PENDING"
        ? "Future local use is revoked. PayPal's token deletion is still pending."
        : "The saved Sandbox wallet was disconnected for future purchases.");
    } catch (cause) {
      setError(walletErrorText(cause));
    } finally {
      setAction(null);
    }
  }

  async function completeApproval(vaultSetupToken: string, state: string) {
    try {
      const result = await walletRequest<{ status: string }>("/api/paypal/sandbox/payment-token", "POST", {
        vaultSetupToken,
        state,
      });
      if (result.status !== "CONNECTED") throw new WalletUiError("PAYPAL_OUTCOME_UNKNOWN");
      setupRef.current = null;
      setOutcomeUnknown(false);
      setSdk(null);
      await refresh();
      setNotice("Your PayPal Sandbox test wallet is saved. A separate purchase permission is still required.");
    } catch (cause) {
      // A lost response after sending the exchange cannot be treated as a
      // failed setup. Keep its exact token and state for an idempotent retry.
      const unknown = !(cause instanceof WalletUiError) || cause.code === "PAYPAL_OUTCOME_UNKNOWN" || cause.code.startsWith("HTTP_5");
      if (unknown) {
        setOutcomeUnknown(true);
        setSdk(null);
      }
      setError(unknown ? walletErrorText(new WalletUiError("PAYPAL_OUTCOME_UNKNOWN")) : walletErrorText(cause));
    }
  }

  async function retryApproval() {
    const setup = setupRef.current;
    if (!setup) return;
    setAction("retrying");
    setError("");
    await completeApproval(setup.setupToken, setup.state);
    setAction(null);
  }

  async function renderButtons() {
    if (!sdk || renderedRef.current) return;
    if (!window.paypalWallet?.Buttons) {
      setError("The official PayPal Sandbox approval button could not load.");
      return;
    }
    renderedRef.current = true;
    try {
      await window.paypalWallet.Buttons({
        createVaultSetupToken: async () => {
          const setup = await walletRequest<SetupToken>("/api/paypal/sandbox/setup-token", "POST");
          if (!setup.setupToken || !setup.state) throw new WalletUiError("WALLET_SETUP_INVALID_OR_CONSUMED");
          setupRef.current = setup;
          return setup.setupToken;
        },
        onApprove: async ({ vaultSetupToken }: { vaultSetupToken: string }) => {
          const setup = setupRef.current;
          if (!setup || setup.setupToken !== vaultSetupToken) {
            setError("This Sandbox approval does not match the setup you started. No wallet was saved.");
            return;
          }
          await completeApproval(vaultSetupToken, setup.state);
        },
        onCancel: () => {
          setupRef.current = null;
          setNotice("Sandbox wallet approval was canceled. No wallet was saved.");
        },
        onError: () => {
          setError("PayPal Sandbox approval did not complete. Check the connection status before trying again.");
        },
      }).render("#sandbox-wallet-buttons");
    } catch {
      renderedRef.current = false;
      setError("The official PayPal Sandbox approval button could not be shown.");
    }
  }

  const sdkUrl = sdk
    ? `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(sdk.clientId)}&merchant-id=${encodeURIComponent(sdk.merchantId)}`
    : null;

  return (
    <section className="card section-card wallet-card" aria-labelledby="wallet-title">
      <div className="card-heading"><div><span className="section-index">PAYMENT SETUP · SANDBOX ONLY</span><h2 id="wallet-title">Save a test wallet</h2></div><span className="fixture-chip">PayPal Sandbox</span></div>
      <p className="muted">A test buyer approves a saved PayPal wallet here. This does not buy a reward or grant purchase permission. Live payments are disabled.</p>
      <div className="wallet-status" role="status"><span className={`wallet-status-dot ${wallet?.status === "CONNECTED" ? "connected" : ""}`} /><strong>{loading ? "Checking connection…" : statusUnavailable ? "Connection status unavailable" : wallet?.status === "CONNECTED" ? "Sandbox wallet saved" : wallet?.configured ? "Sandbox wallet not connected" : "Sandbox setup not configured"}</strong><span>{statusUnavailable ? "Refresh the status before starting another approval." : wallet?.status === "CONNECTED" ? "Saved locally after Sandbox approval. Payment still requires the separate purchase gate." : wallet?.configured ? "Merchant settings detected; Vault access is not yet verified." : "Developer account access is still pending."}</span></div>
      {notice && <p className="wallet-notice" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {statusUnavailable ? (
        <button type="button" className="button button-secondary" disabled={loading || action !== null} onClick={() => void refresh()}>Refresh connection status</button>
      ) : wallet?.status === "CONNECTED" ? (
        <button type="button" className="button button-secondary" disabled={action !== null} onClick={() => void disconnect()}>{action === "disconnecting" ? "Disconnecting…" : "Disconnect saved Sandbox wallet"}</button>
      ) : outcomeUnknown ? (
        <div className="wallet-recovery"><p>Approval may have reached PayPal. Check the local connection, then retry only this same approval if it is still missing.</p><div className="wallet-recovery-actions"><button type="button" className="button button-secondary" disabled={loading || action !== null} onClick={() => void refresh()}>Check connection</button>{setupRef.current && <button type="button" className="button button-secondary" disabled={loading || action !== null} onClick={() => void retryApproval()}>{action === "retrying" ? "Retrying same approval…" : "Retry same approval"}</button>}</div></div>
      ) : wallet?.configured ? (
        <>
          {!sdk && <button type="button" className="button button-secondary" disabled={action !== null || outcomeUnknown} onClick={() => void startSetup()}>{action === "starting" ? "Preparing approval…" : "Connect PayPal Sandbox wallet"}</button>}
          {sdk && <><div id="sandbox-wallet-buttons" className="paypal-buttons" aria-label="PayPal Sandbox wallet approval" />{sdkUrl && <Script key={sdk.idToken} src={sdkUrl} strategy="afterInteractive" data-namespace="paypalWallet" data-user-id-token={sdk.idToken} onReady={() => void renderButtons()} onError={() => setError("The official PayPal Sandbox script could not load.")} />}</>}
        </>
      ) : (
        <p className="wallet-handoff">The project owner must configure a PayPal Developer <strong>Sandbox</strong> merchant app before this step can run. <a href="https://developer.paypal.com/" target="_blank" rel="noreferrer">Open PayPal Developer</a>.</p>
      )}
    </section>
  );
}
