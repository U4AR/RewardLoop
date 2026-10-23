import { existsSync } from "node:fs";
import { getPool } from "../src/db/client";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const products = [
  ["focus-timer-cream", "Focus timer", "Cream", 2900, 300, 232],
  ["study-lamp-sage", "Study lamp", "Sage green", 3200, 400, 288],
  ["notebook-set-blue", "Notebook set", "Blue, set of three", 1800, 300, 168],
];
for (const item of products) {
  await getPool().query(
    `INSERT INTO demo_products (sku,title,variant,price_minor,shipping_minor,tax_minor)
     VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (sku) DO NOTHING`, item,
  );
}
await getPool().end();
console.log("Synthetic demo catalog seeded (no retailer inventory or orders)");
