import { z } from "zod";
import { withCatalog } from "../../../../server/catalog-http";

export const runtime = "nodejs";

const inputSchema = z.object({
  query: z.string().trim().min(2).max(200),
  limit: z.number().int().min(1).max(6).default(6),
  filters: z.object({
    conditions: z.array(z.enum(["new", "used", "refurbished"])).max(3).optional(),
    availability: z.array(z.enum(["InStock", "OutOfStock"])).max(2).optional(),
  }).strict().default({}),
}).strict();

export async function POST(request: Request): Promise<Response> {
  return withCatalog(request, async (catalog, raw) => {
    const input = inputSchema.parse(raw);
    const products = await catalog.search(input.query, input.filters, input.limit);
    return { products, provenance: "channel3" as const };
  });
}
