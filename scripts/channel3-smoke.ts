import { readFileSync } from "node:fs";
import { Channel3Catalog } from "../src/integrations/channel3";

const local = readFileSync(".env.local", "utf8");
const apiKey = /^CHANNEL3_API_KEY=(.*)$/m.exec(local)?.[1]?.trim();
if (!apiKey) throw new Error("Set CHANNEL3_API_KEY in ignored .env.local first");

const catalog = new Channel3Catalog({ apiKey, timeoutMs: 10000 });
const products = await catalog.search("study timer", {}, 2);
const first = products[0];
if (!first) throw new Error("Channel3 returned no products for the bounded smoke search");
const refreshed = await catalog.getProduct(first.sourceProductId);
const firstOfferUrl = first.offers[0]?.sourceUrl;
const lookup = firstOfferUrl ? await catalog.lookup(firstOfferUrl) : null;

process.stdout.write(JSON.stringify({
  provider: "channel3",
  searchProducts: products.length,
  firstProductReference: first.sourceProductId,
  firstProductUsdOffers: first.offers.length,
  detailFound: Boolean(refreshed),
  lookupStatus: lookup?.status ?? "no_eligible_source_url",
  observedAt: first.observedAt,
}, null, 2) + "\n");
