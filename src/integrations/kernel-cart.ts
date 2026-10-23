import { randomUUID } from "node:crypto";
import Kernel from "@onkernel/sdk";

type CartState = {
  accountSessionId: string;
  sku: string;
  destinationId: "demo-us-address";
  syntheticOnly: true;
  checkoutEnabled: false;
  shipment: false;
};

export type KernelCartResult = {
  writerSessionId: string;
  readerSessionId: string;
  storeSessionId: string;
  sku: string;
};

export class KernelCartError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function kernelStoreOrigin(raw: string | undefined, appRaw: string): URL {
  if (!raw) throw new KernelCartError("PUBLIC_HTTPS_STORE_REQUIRED");
  let store: URL, app: URL;
  try { store = new URL(raw); app = new URL(appRaw); }
  catch { throw new KernelCartError("PUBLIC_HTTPS_STORE_REQUIRED"); }
  const host = store.hostname.toLowerCase();
  if (store.protocol !== "https:" || store.origin === app.origin || store.pathname !== "/" ||
      store.search || store.hash || store.username || store.password || store.port ||
      host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") ||
      host.endsWith(".example") || !host.includes(".") || /^\d+(?:\.\d+){3}$/.test(host) ||
      host.startsWith("[") || host === "example.com" || host.endsWith(".example.com")) {
    throw new KernelCartError("PUBLIC_HTTPS_STORE_REQUIRED");
  }
  return store;
}

function exactCart(raw: unknown, expectedSessionId: string, sku: string): raw is CartState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const cart = raw as Record<string, unknown>;
  return cart.accountSessionId === expectedSessionId && cart.sku === sku &&
    cart.destinationId === "demo-us-address" && cart.syntheticOnly === true &&
    cart.checkoutEnabled === false && cart.shipment === false;
}

/** Only the synthetic store host is reachable from these browser sessions. */
export async function runKernelTwoSessionCart(input: {
  apiKey: string | undefined;
  appOrigin: string;
  storeOrigin: string | undefined;
  storeSessionId: string;
  setupCode: string;
  sku: string;
}, suppliedClient?: Kernel): Promise<KernelCartResult> {
  if (!input.apiKey?.trim()) throw new KernelCartError("KERNEL_KEY_REQUIRED");
  const origin = kernelStoreOrigin(input.storeOrigin, input.appOrigin);
  if (!/^[0-9a-f-]{36}$/i.test(input.storeSessionId) || !/^[A-Za-z0-9_-]{24}$/.test(input.setupCode) ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(input.sku)) throw new KernelCartError("INVALID_KERNEL_CART_INPUT");

  const kernel = suppliedClient ?? new Kernel({ apiKey: input.apiKey });
  const profileName = `rewardloop-cart-${randomUUID()}`;
  const storeUrl = new URL("/store", origin).toString();
  const network = { allowed_hosts: [origin.hostname], private_hosts: [] };
  const options = { timeout: 45_000, maxRetries: 0 };
  let writerId: string | null = null;
  let readerId: string | null = null;
  let profileCreated = false;
  let outcome: KernelCartResult | undefined;
  let failure: KernelCartError | undefined;
  try {
    await kernel.profiles.create({ name: profileName }, options);
    profileCreated = true;
    const writer = await kernel.browsers.create({
      profile: { name: profileName, save_changes: true }, start_url: storeUrl,
      network, headless: false, timeout_seconds: 180,
    }, options);
    writerId = writer.session_id;
    if (!writerId) throw new KernelCartError("KERNEL_WRITER_MISSING");
    const saved = await kernel.browsers.playwright.execute(writerId, {
      code: `
        await page.goto(${JSON.stringify(storeUrl)}, { waitUntil: 'domcontentloaded' });
        if (new URL(page.url()).origin !== ${JSON.stringify(origin.origin)}) throw new Error('Store navigation changed');
        await page.getByLabel('One-time synthetic store code').fill(${JSON.stringify(input.setupCode)});
        await page.getByRole('button', { name: 'Sign in to demo store' }).click();
        await page.getByLabel('Synthetic demo product').selectOption(${JSON.stringify(input.sku)});
        await page.getByRole('button', { name: 'Save synthetic cart' }).click();
        await page.getByText('Synthetic cart saved.', { exact: false }).waitFor();
        return await page.evaluate(async () => {
          const response = await fetch('/api/store/cart', { cache: 'no-store' });
          return response.ok ? await response.json() : null;
        });
      `,
      timeout_sec: 60,
    }, { timeout: 70_000, maxRetries: 0 });
    if (!saved.success || !exactCart(saved.result, input.storeSessionId, input.sku)) {
      throw new KernelCartError("KERNEL_WRITER_CART_MISMATCH");
    }
    await kernel.browsers.deleteByID(writerId, options);
    const completedWriterId = writerId;
    writerId = null;

    const reader = await kernel.browsers.create({
      profile: { name: profileName, save_changes: false }, start_url: storeUrl,
      network, headless: false, timeout_seconds: 180,
    }, options);
    readerId = reader.session_id;
    if (!readerId || readerId === completedWriterId) throw new KernelCartError("KERNEL_READER_NOT_DISTINCT");
    const restored = await kernel.browsers.playwright.execute(readerId, {
      code: `
        await page.goto(${JSON.stringify(storeUrl)}, { waitUntil: 'domcontentloaded' });
        if (new URL(page.url()).origin !== ${JSON.stringify(origin.origin)}) throw new Error('Store navigation changed');
        return await page.evaluate(async () => {
          const response = await fetch('/api/store/cart', { cache: 'no-store' });
          return response.ok ? await response.json() : null;
        });
      `,
      timeout_sec: 35,
    }, { timeout: 45_000, maxRetries: 0 });
    if (!restored.success || !exactCart(restored.result, input.storeSessionId, input.sku)) {
      throw new KernelCartError("KERNEL_RESTORED_CART_MISMATCH");
    }
    outcome = { writerSessionId: completedWriterId, readerSessionId: readerId,
      storeSessionId: input.storeSessionId, sku: input.sku };
  } catch (error) {
    failure = error instanceof KernelCartError ? error : new KernelCartError("KERNEL_PROVIDER_UNAVAILABLE");
  }

  // Never return a verified result while a session or saved cookie profile is
  // still active. Do not expose Live View URLs, browser cookies, or provider errors.
  let cleanupFailed = false;
  if (readerId) await kernel.browsers.deleteByID(readerId, options).catch(() => { cleanupFailed = true; });
  if (writerId) await kernel.browsers.deleteByID(writerId, options).catch(() => { cleanupFailed = true; });
  if (profileCreated) await kernel.profiles.delete(profileName, options).catch(() => { cleanupFailed = true; });
  if (cleanupFailed) throw new KernelCartError("KERNEL_CLEANUP_UNCONFIRMED");
  if (failure) throw failure;
  if (!outcome) throw new KernelCartError("KERNEL_RESULT_MISSING");
  return outcome;
}
