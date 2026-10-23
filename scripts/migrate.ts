import { existsSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { getDb, getPool } from "../src/db/client";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
await migrate(getDb(), { migrationsFolder: "src/db/migrations" });
await getPool().end();
console.log("RewardLoop domain migrations applied");

