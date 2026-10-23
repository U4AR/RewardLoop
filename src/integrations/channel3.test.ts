import { describe, expect, it, vi } from "vitest";
import {
  Channel3Catalog,
  Channel3Error,
  normalizeChannel3Product,
  usdToMinorUnits,
  validatePublicProductUrl,
} from "./channel3";

const product = {
  id: "item-123",
  title: "Study lamp",
  brands: [{ id: "brand-1", name: "Bright" }],
  images: [{ url: "https://cdn.example.org/lamp.jpg", cleaned_url: null, alt_text: "Desk lamp" }],
  variants: {
    selected: [{ name: "Color", label: "Blue" }],
    options: [{ name: "Color", values: [
      { label: "Blue", product_id: "item-123", exists: true, available: "InStock" },
      { label: "Red", product_id: "item-456", exists: true, available: "OutOfStock" },
    ] }],
  },
  offers: [
    { url: "https://buy.trychannel3.com/offer/123", domain: "shop.example.org", price: { price: 19.99, currency: "USD" }, availability: "InStock", condition: "new" },
    { url: "https://buy.trychannel3.com/offer/eur", domain: "shop.example.org", price: { price: 10, currency: "EUR" }, availability: "InStock" },
  ],
};

describe("Channel3 normalization", () => {
  it("preserves exact variant and merchant data while retaining only safe USD offers", () => {
    const result = normalizeChannel3Product(product, "2026-10-07T00:00:00.000Z");
    expect(result.sourceProductId).toBe("item-123");
    expect(result.brands).toEqual(["Bright"]);
    expect(result.selectedVariant).toEqual({ productId: "item-123", options: [{ name: "Color", label: "Blue" }] });
    expect(result.variantOptions[0].values[1].productId).toBe("item-456");
    expect(result.offers).toEqual([{
      sourceOfferReference: "https://buy.trychannel3.com/offer/123",
      sourceMerchantDomain: "shop.example.org",
      sourceUrl: "https://buy.trychannel3.com/offer/123",
      currency: "USD",
      observedPriceMinor: 1999,
      availability: "in_stock",
      condition: "new",
    }]);
    expect(result.observedAt).toBe("2026-10-07T00:00:00.000Z");
  });

  it("marks a product without an eligible USD offer as discovery only", () => {
    const result = normalizeChannel3Product({ ...product, offers: [product.offers[1]] });
    expect(result.offers).toEqual([]);
    expect(result.discoveryOnlyReason).toMatch(/USD/);
  });

  it("converts prices to cents exactly and rejects sub-cent precision", () => {
    expect(usdToMinorUnits(19.99)).toBe(1999);
    expect(usdToMinorUnits("0.01")).toBe(1);
    expect(usdToMinorUnits(1e3)).toBe(100000);
    expect(usdToMinorUnits("12.300")).toBe(1230);
    expect(() => usdToMinorUnits("12.301")).toThrow(/sub-cent/);
    expect(() => usdToMinorUnits(0)).toThrow(/range/);
  });
});

describe("Channel3 URL boundary", () => {
  it.each([
    "http://127.0.0.1/item",
    "http://[::1]/item",
    "https://localhost/item",
    "https://store.internal/item",
    "https://buyer:secret@store.example.org/item",
    "https://store.example.org:8080/item",
    "file:///etc/passwd",
    "https://store.example.org/item ",
  ])("rejects non-public or credential-bearing URL %s", (url) => {
    expect(() => validatePublicProductUrl(url)).toThrow();
  });

  it("accepts a public product URL", () => {
    expect(validatePublicProductUrl("https://shop.example.org/item?id=1"))
      .toBe("https://shop.example.org/item?id=1");
  });
});

describe("Channel3 API adapter", () => {
  it("sends a single bounded search and normalizes its response", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ products: [product], next_page_token: "ignored" }), { status: 200 })) as typeof fetch;
    const catalog = new Channel3Catalog({ apiKey: "test-key", fetch: fetcher });
    const result = await catalog.search("study lamp", { availability: ["InStock"] }, 1);
    expect(result).toHaveLength(1);
    expect(result[0].offers[0].observedPriceMinor).toBe(1999);
    const [url, options] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe("https://api.trychannel3.com/v1/search");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toMatchObject({ "x-api-key": "test-key" });
    expect(JSON.parse(String(options?.body))).toEqual({
      query: "study lamp", limit: 1, filters: { availability: ["InStock"] },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("validates lookup URLs before any provider call", async () => {
    const fetcher = vi.fn() as unknown as typeof fetch;
    const catalog = new Channel3Catalog({ apiKey: "test-key", fetch: fetcher });
    await expect(catalog.lookup("http://localhost/admin")).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns an explicit unsupported result for a missing product", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 404 })) as typeof fetch;
    const catalog = new Channel3Catalog({ apiKey: "test-key", fetch: fetcher });
    expect(await catalog.lookup("https://shop.example.org/item")).toEqual({
      status: "unsupported", reason: "not_found_or_unsupported",
    });
  });

  it("uses the documented product-detail path and does not leak provider body on errors", async () => {
    const fetcher = vi.fn(async () => new Response("sensitive-provider-body", { status: 503 })) as typeof fetch;
    const catalog = new Channel3Catalog({ apiKey: "test-key", fetch: fetcher });
    await expect(catalog.getProduct("item-123")).rejects.toMatchObject({ status: 503 });
    const [url, options] = vi.mocked(fetcher).mock.calls[0];
    expect(url).toBe("https://api.trychannel3.com/v1/products/item-123");
    expect(options?.method).toBe("GET");
    expect(new Channel3Error("Channel3 returned HTTP 503", 503).message).not.toContain("sensitive-provider-body");
  });
});
