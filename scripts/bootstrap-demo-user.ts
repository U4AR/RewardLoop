import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const email = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
const password = process.env.DEMO_USER_PASSWORD;
if (!email?.endsWith("@rewardloop.test") || !password || password.length < 16) {
  throw new Error("Set a synthetic DEMO_USER_EMAIL at rewardloop.test and a DEMO_USER_PASSWORD of at least 16 characters");
}

// This flag applies only to this one-off process. The deployed web app keeps
// public sign-up disabled; no temporary public registration window is needed.
process.env.ALLOW_LOCAL_SIGNUP = "true";
const { getAuth } = await import("../src/lib/auth");
const { getPool } = await import("../src/db/client");

try {
  const existing = await getPool().query('SELECT id FROM "user" WHERE email = $1 LIMIT 1', [email]);
  if (existing.rowCount) {
    console.log("Synthetic judge account already exists; no password was changed");
  } else {
    await getAuth().api.signUpEmail({ body: { name: "RewardLoop Demo", email, password } });
    console.log("Synthetic judge account created");
  }
} finally {
  await getPool().end();
}
