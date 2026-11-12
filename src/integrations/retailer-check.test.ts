import { describe, expect, it } from "vitest";
import { retailerReport } from "./retailer-check";

const url = "https://www.retailer.com/products/desk-lamp";
const page = { url, title: "Desk lamp", offers: [{ price: "32.49", currency: "USD", availability: "https://schema.org/InStock" }] };
describe("retailer page observations", () => {
  it("reads an exact USD offer without calling it a final checkout total", () => {
    const report = retailerReport(page, url);
    expect(report).toMatchObject({ priceMinor: 3249, currency: "USD", availability: "in_stock", status: "checked" });
    expect(report.message).toContain("shipping, tax");
  });
  it("does not silently choose a cheaper variant or convert a foreign currency", () => {
    expect(retailerReport({ ...page, offers: [...page.offers, { ...page.offers[0], price: "9.99" }] }, url).priceMinor).toBeNull();
    expect(retailerReport({ ...page, offers: [{ ...page.offers[0], currency: "EUR" }] }, url).priceMinor).toBeNull();
  });
  it("rejects redirects to another merchant or a private target", () => {
    expect(() => retailerReport({ ...page, url: "https://other-retailer.com/product" }, url)).toThrow("different merchant");
    expect(() => retailerReport({ ...page, url: "http://127.0.0.1/" }, url)).toThrow();
  });
  it("allows the catalog's known affiliate redirect only to the bound merchant", () => {
    expect(retailerReport(page, "https://buy.trychannel3.com/link", "retailer.com").priceMinor).toBe(3249);
    expect(() => retailerReport({ ...page, url: "https://other-retailer.com/lamp" }, "https://buy.trychannel3.com/link", "retailer.com")).toThrow("different merchant");
    expect(() => retailerReport(page, "https://arbitrary-redirect.com/link", "retailer.com")).toThrow("Unrecognized");
  });
  it("preserves unknown prices and out-of-stock observations", () => {
    expect(retailerReport({ ...page, offers: [] }, url)).toMatchObject({ status: "limited", priceMinor: null, availability: "unknown" });
    expect(retailerReport({ ...page, offers: [{ ...page.offers[0], availability: "https://schema.org/OutOfStock" }] }, url).availability).toBe("out_of_stock");
  });
});
