import { z } from "zod";
import { getUser } from "@/lib/session";
import { getPool } from "@/db/client";

export const runtime = "nodejs";

/** Serves a check-in photo or voice recording to its owner only. */
export async function GET(request: Request) {
  const user = await getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  const id = z.uuid().safeParse(new URL(request.url).searchParams.get("id"));
  if (!id.success) return new Response("Not found.", { status: 404 });
  const row = (await getPool().query("SELECT media_mime, media_data FROM reward_checkins WHERE id=$1 AND user_id=$2 AND media_data IS NOT NULL", [id.data, user.id])).rows[0];
  if (!row) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(row.media_data), { headers: {
    "Content-Type": row.media_mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox",
  } });
}
