import Kernel from "@onkernel/sdk";
import { z } from "zod";
import { usdToMinorUnits, validatePublicProductUrl } from "./channel3";

const pageResult = z.object({
  url: z.string(), title: z.string().max(500),
  offers: z.array(z.object({ price: z.union([z.string(), z.number()]).nullable(), currency: z.string().nullable(), availability: z.string().nullable() })).max(10),
});

export type RetailerCheck = {
  source: "kernel"; status: "checked" | "limited"; title: string; url: string;
  priceMinor: number | null; currency: "USD" | null;
  availability: "in_stock" | "out_of_stock" | "unknown"; checkedAt: string;
  message: string;
};

export function retailerReport(raw: unknown, expectedUrl: string, merchantDomain?: string): RetailerCheck {
  const result = pageResult.parse(raw);
  const expected = new URL(validatePublicProductUrl(expectedUrl));
  const actual = new URL(validatePublicProductUrl(result.url));
  if (merchantDomain) {
    const merchant = new URL(validatePublicProductUrl(`https://${merchantDomain}/`));
    if (expected.hostname !== "buy.trychannel3.com" && expected.hostname.replace(/^www\./, "") !== merchant.hostname.replace(/^www\./, "")) throw new Error("Unrecognized retailer redirect provider");
    expected.hostname = merchant.hostname;
  }
  if (actual.hostname.replace(/^www\./, "") !== expected.hostname.replace(/^www\./, "")) throw new Error(`Retailer redirected to a different merchant (${expected.hostname} to ${actual.hostname})`);
  // Multiple offers can refer to variants. Do not choose the cheapest variant.
  const offer = result.offers.length === 1 ? result.offers[0] : null;
  let priceMinor: number | null = null;
  if (offer?.currency === "USD" && offer.price !== null) {
    try { priceMinor = usdToMinorUnits(offer.price); } catch { /* Unknown price stays unknown. */ }
  }
  const availability = offer?.availability?.endsWith("/InStock") ? "in_stock" as const
    : offer?.availability?.endsWith("/OutOfStock") || offer?.availability?.endsWith("/SoldOut") ? "out_of_stock" as const : "unknown" as const;
  return { source: "kernel", status: priceMinor !== null ? "checked" : "limited", title: result.title, url: actual.toString(),
    priceMinor, currency: priceMinor !== null ? "USD" : null, availability, checkedAt: new Date().toISOString(),
    message: priceMinor !== null ? "Public product-page price observed. Confirm the variant, shipping, tax, and final total at the retailer."
      : "The retailer did not expose a single readable USD offer. Confirm the price and availability on its website." };
}

/** A short-lived, read-only browser. No retailer account, cart, or payment actions. */
export async function checkRetailerPage(url: string, apiKey: string, merchantDomain?: string): Promise<RetailerCheck> {
  const safeUrl = validatePublicProductUrl(url);
  const sourceHost = new URL(safeUrl).hostname;
  const host = new URL(validatePublicProductUrl(`https://${merchantDomain ?? sourceHost}/`)).hostname.replace(/^www\./, "");
  if (sourceHost !== "buy.trychannel3.com" && sourceHost.replace(/^www\./, "") !== host) throw new Error("Unrecognized retailer redirect provider");
  const client = new Kernel({ apiKey, maxRetries: 0 });
  let sessionId: string | undefined;
  try {
    const browser = await client.browsers.create({
      headless: true, timeout_seconds: 90,
      network: { allowed_hosts: [...new Set([sourceHost, host, `www.${host}`])], private_hosts: [] },
    }, { timeout: 20000 });
    sessionId = browser.session_id;
    const result = await client.browsers.playwright.execute(sessionId, {
      timeout_sec: 35,
      code: `
        await page.goto(${JSON.stringify(safeUrl)}, { waitUntil: 'domcontentloaded', timeout: 25000 });
        return await page.evaluate(() => {
          const products = [];
          const visit = value => {
            if (!value || typeof value !== 'object') return;
            if (Array.isArray(value)) { value.forEach(visit); return; }
            const types = Array.isArray(value['@type']) ? value['@type'] : [value['@type']];
            if (types.includes('Product')) products.push(value);
            if (value['@graph']) visit(value['@graph']);
            if (value.mainEntity) visit(value.mainEntity);
          };
          for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
            if ((script.textContent || '').length > 200000) continue;
            try { visit(JSON.parse(script.textContent)); } catch {}
          }
          const offers = products.length === 1 ? [].concat(products[0].offers || []).slice(0,10).map(offer => ({
            price: typeof offer.price === 'string' || typeof offer.price === 'number' ? offer.price : null,
            currency: typeof offer.priceCurrency === 'string' ? offer.priceCurrency : null,
            availability: typeof offer.availability === 'string' ? offer.availability : null,
          })) : [];
          return { url: location.href, title: document.title.slice(0,500), offers };
        });`,
    }, { timeout: 45000 });
    if (!result.success) throw new Error("Retailer browser check did not finish");
    return retailerReport(result.result, safeUrl, merchantDomain);
  } finally {
    if (sessionId) await client.browsers.deleteByID(sessionId, { timeout: 15000, maxRetries: 1 });
  }
}
