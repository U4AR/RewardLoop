import { existsSync } from "node:fs";
import { getConfig } from "../src/config";
import { reviewWithVertex } from "../src/integrations/vertex-review";
import { Channel3Catalog } from "../src/integrations/channel3";
import { checkRetailerPage } from "../src/integrations/retailer-check";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const config = getConfig();
const rubric = "Explain how a database index speeds a lookup and identify one write cost and one storage cost.";
if (!process.argv.includes("--kernel-only")) for (const [label, notes] of [
  ["weak", "I studied indexes today. They make database queries faster and they are good."],
  ["complete", "A B-tree index maps sorted key values to row locations, so a lookup can jump to matching records instead of scanning every row. Inserts and updates must maintain the index, adding write work. The index also occupies additional disk space."],
]) {
  const review = await reviewWithVertex({ rubric, notes }, config);
  console.log(JSON.stringify({ provider: review.provider, model: review.model, sample: label, decision: review.decision, reason: review.reason }));
  if ((label === "weak" && review.decision === "accepted") || (label === "complete" && review.decision !== "accepted")) throw new Error("Evidence review smoke did not match the rubric");
}
if (!config.CHANNEL3_API_KEY) throw new Error("Channel3 is not configured");
const catalog = new Channel3Catalog({ apiKey: config.CHANNEL3_API_KEY, timeoutMs: 15000 });
const products = await catalog.search("watercolor painting set", {}, 3);
console.log(JSON.stringify({ catalog: "channel3", products: products.length, titles: products.map(p => p.title) }));
const product = products.find(p => p.offers.length);
if (!product) throw new Error("No real retailer offer returned");
const refreshed = await catalog.getProduct(product.sourceProductId);
console.log(JSON.stringify({ productRefresh: Boolean(refreshed), merchant: product.offers[0].sourceMerchantDomain }));
if (process.argv.includes("--kernel") || process.argv.includes("--kernel-only")) {
  if (!config.KERNEL_API_KEY) throw new Error("Kernel is not configured");
  const report = await checkRetailerPage(product.offers[0].sourceUrl, config.KERNEL_API_KEY, product.offers[0].sourceMerchantDomain);
  console.log(JSON.stringify({ browser: "kernel", status: report.status, priceMinor: report.priceMinor, availability: report.availability, message: report.message }));
}
