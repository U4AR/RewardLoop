import { z } from "zod";
import { withCatalog } from "../../../../server/catalog-http";

export const runtime = "nodejs";

const inputSchema = z.object({ url: z.string().min(8).max(2048) }).strict();

export async function POST(request: Request): Promise<Response> {
  return withCatalog(request, async (catalog, raw) => {
    const input = inputSchema.parse(raw);
    return { ...(await catalog.lookup(input.url)), provenance: "channel3" as const };
  });
}
