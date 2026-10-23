import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

if (existsSync(".env.local")) {
  console.log("Existing .env.local preserved");
  process.exit(0);
}

const example = readFileSync(".env.example", "utf8");
const authSecret = randomBytes(48).toString("base64url");
const dataKey = randomBytes(32).toString("base64url");
const local = example
  .replace(/^BETTER_AUTH_SECRET=$/m, `BETTER_AUTH_SECRET=${authSecret}`)
  .replace(/^DATA_ENCRYPTION_KEY=$/m, `DATA_ENCRYPTION_KEY=${dataKey}`);
writeFileSync(".env.local", local, { mode: 0o600, flag: "wx" });
console.log("Created ignored local configuration with generated secrets");
