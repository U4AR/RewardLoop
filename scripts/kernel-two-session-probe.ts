/**
 * Local, explicitly invoked Kernel smoke probe. It never makes a payment and
 * never opens a retailer. Required env: KERNEL_API_KEY, MOCK_STORE_ORIGIN,
 * APP_ORIGIN, STORE_SETUP_CODE (from the authenticated app route), PROBE_SKU.
 * Do not run it during build or CI; headful browsers consume provider usage.
 */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import Kernel from "@onkernel/sdk";
import { kernelStoreOrigin } from "../src/integrations/kernel-cart";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live Kernel probe`);
  return value;
}

async function main() {
  const apiKey = required("KERNEL_API_KEY");
  const storeOrigin = kernelStoreOrigin(required("MOCK_STORE_ORIGIN"), required("APP_ORIGIN"));
  const setupCode = required("STORE_SETUP_CODE");
  const sku = required("PROBE_SKU");
  if (!/^[A-Za-z0-9_-]{24}$/.test(setupCode)) throw new Error("STORE_SETUP_CODE has the wrong format");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(sku)) throw new Error("PROBE_SKU has the wrong format");

  const kernel = new Kernel({ apiKey });
  const profileName = `rewardloop-probe-${randomUUID()}`;
  let profileCreated = false;
  let writerId: string | null = null;
  let readerId: string | null = null;
  const storeUrl = new URL("/store", storeOrigin).toString();

  try {
    await kernel.profiles.create({ name: profileName });
    profileCreated = true;
    const writer = await kernel.browsers.create({
      profile: { name: profileName, save_changes: true },
      start_url: storeUrl,
      headless: false,
    });
    writerId = writer.session_id;
    if (!writer.browser_live_view_url) throw new Error("Kernel did not provide a Live View capability");

    // This fixed script controls only our synthetic store. It uses the one-time
    // code without printing it, the Live View capability, or browser cookies.
    const setup = await kernel.browsers.playwright.execute(writerId, {
      code: `
        await page.goto(${JSON.stringify(storeUrl)}, { waitUntil: 'domcontentloaded' });
        await page.getByLabel('One-time synthetic store code').fill(${JSON.stringify(setupCode)});
        await page.getByRole('button', { name: 'Sign in to demo store' }).click();
        await page.getByLabel('Synthetic demo product').selectOption(${JSON.stringify(sku)});
        await page.getByRole('button', { name: 'Save synthetic cart' }).click();
        await page.getByText('Synthetic cart saved.', { exact: false }).waitFor();
        return await page.evaluate(async () => {
          const response = await fetch('/api/store/cart', { cache: 'no-store' });
          return response.ok ? await response.json() : { error: response.status };
        });
      `,
      timeout_sec: 60,
    });
    if (!setup.success || !setup.result || typeof setup.result !== "object") {
      throw new Error("First Kernel session could not save the synthetic cart");
    }
    const saved = setup.result as { accountSessionId?: string; sku?: string; syntheticOnly?: boolean };
    if (!saved.accountSessionId || saved.sku !== sku || saved.syntheticOnly !== true) {
      throw new Error("First Kernel session returned an unexpected store state");
    }

    await kernel.browsers.deleteByID(writerId);
    writerId = null;

    const reader = await kernel.browsers.create({ profile: { name: profileName }, start_url: storeUrl, headless: false });
    readerId = reader.session_id;
    if (readerId === writer.session_id) throw new Error("Kernel reused the writer session ID");
    const restored = await kernel.browsers.playwright.execute(readerId, {
      code: `
        await page.goto(${JSON.stringify(storeUrl)}, { waitUntil: 'domcontentloaded' });
        return await page.evaluate(async () => {
          const response = await fetch('/api/store/cart', { cache: 'no-store' });
          return response.ok ? await response.json() : { error: response.status };
        });
      `,
      timeout_sec: 30,
    });
    if (!restored.success || !restored.result || typeof restored.result !== "object") {
      throw new Error("Second Kernel session could not read the synthetic cart");
    }
    const current = restored.result as { accountSessionId?: string; sku?: string; syntheticOnly?: boolean };
    if (current.accountSessionId !== saved.accountSessionId || current.sku !== sku || current.syntheticOnly !== true) {
      throw new Error("Saved store login/cart did not survive two distinct Kernel sessions");
    }
    console.log(JSON.stringify({
      result: "VERIFIED_TWO_KERNEL_SESSIONS",
      writerSessionId: writer.session_id,
      readerSessionId: reader.session_id,
      profileName,
      syntheticStoreSessionId: current.accountSessionId,
      sku,
      payment: "none",
      retailerOrder: "none",
    }));
  } finally {
    if (readerId) await kernel.browsers.deleteByID(readerId).catch(() => undefined);
    if (writerId) await kernel.browsers.deleteByID(writerId).catch(() => undefined);
    if (profileCreated) await kernel.profiles.delete(profileName).catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Kernel probe failed");
  process.exitCode = 1;
});
