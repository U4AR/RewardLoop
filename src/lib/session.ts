import { headers } from "next/headers";
import { getAuth } from "./auth";

export async function getUser() {
  const session = await getAuth().api.getSession({ headers: await headers() });
  return session?.user ?? null;
}

