import { betterAuth } from "better-auth";
import { getPool } from "../db/client";
import { getConfig } from "../config";

function createAuth() {
  const config = getConfig();
  return betterAuth({
    database: getPool(),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      disableSignUp: config.ALLOW_LOCAL_SIGNUP !== "true",
    },
    trustedOrigins: [config.APP_ORIGIN],
  });
}

let instance: ReturnType<typeof createAuth> | undefined;

export function getAuth(): ReturnType<typeof createAuth> {
  return instance ??= createAuth();
}
