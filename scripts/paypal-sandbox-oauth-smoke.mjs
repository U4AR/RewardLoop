import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

const SANDBOX_BASE = "https://api-m.sandbox.paypal.com";
const OAUTH_URL = `${SANDBOX_BASE}/v1/oauth2/token`;

class SafeProbeError extends Error {}

async function main() {
  if (!existsSync(".env.local")) throw new SafeProbeError("Missing ignored .env.local");
  // Use this project's ignored file, not inherited credentials from the shell.
  const local = parseEnv(readFileSync(".env.local", "utf8"));
  if (
    local.PAYPAL_ENV !== "sandbox" ||
    local.PAYMENT_PROVIDER !== "paypal_sandbox" ||
    local.PAYPAL_API_BASE_URL !== SANDBOX_BASE ||
    new URL(OAUTH_URL).origin !== SANDBOX_BASE
  ) {
    throw new SafeProbeError("PayPal Sandbox-only environment settings are required");
  }

  const clientId = local.PAYPAL_SANDBOX_CLIENT_ID;
  const clientSecret = local.PAYPAL_SANDBOX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new SafeProbeError("Set Sandbox client ID and secret in ignored .env.local");
  }

  // One bounded OAuth POST. No payment endpoint, redirect, retry, or token log.
  const response = await fetch(OAUTH_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf8").toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // Response bodies can contain provider details; do not read or print them.
    throw new SafeProbeError(`PayPal Sandbox OAuth probe failed with HTTP ${response.status}`);
  }
  const data = await response.json();
  if (
    !data ||
    typeof data.access_token !== "string" ||
    data.access_token.length === 0 ||
    !Number.isFinite(data.expires_in) ||
    data.expires_in <= 0
  ) {
    throw new SafeProbeError("PayPal Sandbox returned an incomplete OAuth response");
  }
  process.stdout.write(JSON.stringify({
    provider: "paypal_sandbox",
    oauth: "accepted",
    tokenExpiresInSeconds: data.expires_in,
  }) + "\n");
}

try {
  await main();
} catch (error) {
  // Never print the error object or stack: a transport error can contain URL,
  // headers, request data, or token material.
  const message = error instanceof SafeProbeError
    ? error.message
    : "PayPal Sandbox OAuth probe could not complete the request";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
