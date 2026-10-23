import { isIP } from "node:net";
import { z } from "zod";

const API_ORIGIN = "https://api.trychannel3.com";

const brandSchema = z.object({ name: z.string().min(1) });
const imageSchema = z.object({
  url: z.string(),
  cleaned_url: z.string().nullish(),
  alt_text: z.string().nullish(),
});
const offerSchema = z.object({
  url: z.string(),
  domain: z.string().min(1),
  price: z.object({
    // Channel3's current API reference calls this `price.price`.
    price: z.union([z.number(), z.string()]),
    currency: z.string(),
  }),
  availability: z.string().nullish(),
  condition: z.string().nullish(),
});
const variantSchema = z.object({
  options: z.array(z.object({
    name: z.string().min(1),
    values: z.array(z.object({
      label: z.string(),
      product_id: z.string().nullish(),
      available: z.string().nullish(),
      exists: z.boolean().nullish(),
    })),
  })).nullish(),
  selected: z.array(z.object({ name: z.string(), label: z.string() })).nullish(),
});
const productSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  brands: z.array(brandSchema).nullish(),
  images: z.array(imageSchema).nullish(),
  offers: z.array(offerSchema).nullish(),
  variants: variantSchema.nullish(),
});
const searchResponseSchema = z.object({ products: z.array(productSchema) });
const lookupResponseSchema = z.object({ product: productSchema });

export type CatalogAvailability = "in_stock" | "out_of_stock" | "unknown";

export interface NormalizedOffer {
  sourceOfferReference: string;
  sourceMerchantDomain: string;
  sourceUrl: string;
  currency: "USD";
  observedPriceMinor: number;
  availability: CatalogAvailability;
  condition: string | null;
}

export interface NormalizedVariantOption {
  name: string;
  values: Array<{
    label: string;
    productId: string | null;
    available: CatalogAvailability;
    exists: boolean;
  }>;
}

export interface NormalizedProduct {
  source: "channel3";
  sourceProductId: string;
  title: string;
  images: Array<{ url: string; altText: string | null }>;
  brands: string[];
  selectedVariant: {
    productId: string;
    options: Array<{ name: string; label: string }>;
  };
  variantOptions: NormalizedVariantOption[];
  offers: NormalizedOffer[];
  observedAt: string;
  discoveryOnlyReason: string | null;
}

export type CatalogLookupResult =
  | { status: "found"; product: NormalizedProduct }
  | { status: "unsupported"; reason: "not_found_or_unsupported" };

export interface CatalogProvider {
  search(query: string, filters?: SearchFilters, limit?: number): Promise<NormalizedProduct[]>;
  lookup(url: string): Promise<CatalogLookupResult>;
  getProduct(reference: string): Promise<NormalizedProduct | null>;
}

export interface SearchFilters {
  conditions?: Array<"new" | "used" | "refurbished">;
  availability?: Array<"InStock" | "OutOfStock">;
}

export class Channel3Error extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "Channel3Error";
  }
}

/**
 * Convert an API decimal to USD cents without floating-point multiplication or
 * rounding. Values with nonzero fractions smaller than a cent are rejected.
 */
export function usdToMinorUnits(value: number | string): number {
  const input = typeof value === "number" ? value.toString() : value.trim();
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("Price must be finite");
  }
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(input);
  if (!match) throw new Error("Price must be a nonnegative decimal");

  const exponent = Number(match[3] ?? "0");
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 12) {
    throw new Error("Price exponent is unsupported");
  }
  const digits = BigInt(match[1] + (match[2] ?? ""));
  const power = 2 + exponent - (match[2]?.length ?? 0);
  let cents: bigint;
  if (power >= 0) {
    cents = digits * (10n ** BigInt(power));
  } else {
    const divisor = 10n ** BigInt(-power);
    if (digits % divisor !== 0n) throw new Error("Price has sub-cent precision");
    cents = digits / divisor;
  }
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Price is outside the supported range");
  }
  return Number(cents);
}

/** Validate URLs before passing them to lookup or displaying provider links. */
export function validatePublicProductUrl(input: string): string {
  if (typeof input !== "string" || input.length > 2048 || input.trim() !== input) {
    throw new Error("Enter a valid public product URL");
  }
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid public product URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    !hostname.includes(".") ||
    isIP(hostname) !== 0 ||
    /\.(?:localhost|local|internal|test|invalid|example|onion)$/.test(hostname) ||
    hostname === "localhost"
  ) {
    throw new Error("Enter a public HTTP(S) product URL without credentials or a custom port");
  }
  return url.toString();
}

function availability(value: string | null | undefined): CatalogAvailability {
  if (value === "InStock") return "in_stock";
  if (value === "OutOfStock") return "out_of_stock";
  return "unknown";
}

export function normalizeChannel3Product(input: unknown, observedAt = new Date().toISOString()): NormalizedProduct {
  const product = productSchema.parse(input);
  const offers: NormalizedOffer[] = [];
  for (const offer of product.offers ?? []) {
    // Non-USD and malformed offers may still be shown by Channel3, but cannot
    // become a purchase candidate in this USD-only demonstration.
    if (offer.price.currency !== "USD") continue;
    try {
      const sourceUrl = validatePublicProductUrl(offer.url);
      const merchantUrl = validatePublicProductUrl(`https://${offer.domain}/`);
      const sourceMerchantDomain = new URL(merchantUrl).hostname.toLowerCase();
      offers.push({
        sourceOfferReference: sourceUrl,
        sourceMerchantDomain,
        sourceUrl,
        currency: "USD",
        observedPriceMinor: usdToMinorUnits(offer.price.price),
        availability: availability(offer.availability),
        condition: offer.condition ?? null,
      });
    } catch {
      continue;
    }
  }

  const images: NormalizedProduct["images"] = [];
  for (const image of product.images ?? []) {
    try {
      images.push({
        url: validatePublicProductUrl(image.cleaned_url || image.url),
        altText: image.alt_text ?? null,
      });
    } catch {
      // Do not hand a private-network or malformed image URL to the browser.
    }
  }

  return {
    source: "channel3",
    sourceProductId: product.id,
    title: product.title,
    images,
    brands: (product.brands ?? []).map((brand) => brand.name),
    selectedVariant: {
      productId: product.id,
      options: product.variants?.selected ?? [],
    },
    variantOptions: (product.variants?.options ?? []).map((option) => ({
      name: option.name,
      values: option.values.map((value) => ({
        label: value.label,
        productId: value.product_id ?? null,
        available: availability(value.available),
        exists: value.exists ?? false,
      })),
    })),
    offers,
    observedAt,
    discoveryOnlyReason: offers.length === 0 ? "No valid USD offer was returned" : null,
  };
}

export class Channel3Catalog implements CatalogProvider {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }) {
    if (!options.apiKey || options.apiKey.trim() !== options.apiKey) {
      throw new Error("A Channel3 API key is required");
    }
    this.apiKey = options.apiKey;
    this.fetcher = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 8000;
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1000 || this.timeoutMs > 30000) {
      throw new Error("Channel3 timeout must be between 1000 and 30000 ms");
    }
  }

  async search(query: string, filters: SearchFilters = {}, limit = 6): Promise<NormalizedProduct[]> {
    const cleaned = query.trim();
    if (cleaned.length < 2 || cleaned.length > 200) {
      throw new Error("Search query must contain 2 to 200 characters");
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 30) {
      throw new Error("Search limit must be between 1 and 30");
    }
    const validatedFilters = z.object({
      conditions: z.array(z.enum(["new", "used", "refurbished"])).max(3).optional(),
      availability: z.array(z.enum(["InStock", "OutOfStock"])).max(2).optional(),
    }).strict().parse(filters);
    const response = await this.request("/v1/search", "POST", { query: cleaned, limit, filters: validatedFilters });
    const parsed = searchResponseSchema.safeParse(response);
    if (!parsed.success) throw new Channel3Error("Channel3 search response has an unsupported schema");
    const observedAt = new Date().toISOString();
    return parsed.data.products.slice(0, limit).map((product) => normalizeChannel3Product(product, observedAt));
  }

  async lookup(input: string): Promise<CatalogLookupResult> {
    const url = validatePublicProductUrl(input);
    try {
      const response = await this.request("/v1/lookup", "POST", { url });
      const parsed = lookupResponseSchema.safeParse(response);
      if (!parsed.success) throw new Channel3Error("Channel3 lookup response has an unsupported schema");
      return { status: "found", product: normalizeChannel3Product(parsed.data.product) };
    } catch (error) {
      if (error instanceof Channel3Error && [404, 422].includes(error.status ?? 0)) {
        return { status: "unsupported", reason: "not_found_or_unsupported" };
      }
      throw error;
    }
  }

  async getProduct(reference: string): Promise<NormalizedProduct | null> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(reference)) {
      throw new Error("Invalid Channel3 product reference");
    }
    try {
      const response = await this.request(`/v1/products/${encodeURIComponent(reference)}`, "GET");
      const parsed = productSchema.safeParse(response);
      if (!parsed.success) throw new Channel3Error("Channel3 product response has an unsupported schema");
      return normalizeChannel3Product(parsed.data);
    } catch (error) {
      if (error instanceof Channel3Error && error.status === 404) return null;
      throw error;
    }
  }

  private async request(path: string, method: "GET" | "POST", body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${API_ORIGIN}${path}`, {
        method,
        headers: {
          "x-api-key": this.apiKey,
          "accept": "application/json",
          ...(method === "POST" ? { "content-type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: "error",
        cache: "no-store",
      });
    } catch {
      throw new Channel3Error("Channel3 request failed or timed out");
    }
    if (!response.ok) {
      // Response bodies can contain request details. Keep this exception safe to log.
      throw new Channel3Error(`Channel3 returned HTTP ${response.status}`, response.status);
    }
    try {
      return await response.json();
    } catch {
      throw new Channel3Error("Channel3 returned invalid JSON", response.status);
    }
  }
}
