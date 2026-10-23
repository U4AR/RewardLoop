import { existsSync } from "node:fs";
import { getMigrations } from "better-auth/db/migration";
import { getAuth } from "../src/lib/auth";
import { getPool } from "../src/db/client";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const { runMigrations } = await getMigrations(getAuth().options);
await runMigrations();
await getPool().end();
console.log("Better Auth tables ready");
