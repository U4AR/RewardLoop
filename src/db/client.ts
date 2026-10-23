import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import { getConfig } from "../config";
import * as schema from "./schema";

const globalDb = globalThis as unknown as { rewardloopPool?: Pool; rewardloopDb?: ReturnType<typeof drizzle<typeof schema>> };

// PostgreSQL DATE is a calendar date, not a midnight instant. Keep its wire value
// so Windows/local timezone conversion cannot shift a goal or purchase window.
types.setTypeParser(1082, (value) => value);

export function getPool(): Pool {
  if (!globalDb.rewardloopPool) {
    globalDb.rewardloopPool = new Pool({ connectionString: getConfig().DATABASE_URL, max: 10 });
  }
  return globalDb.rewardloopPool;
}

export function getDb() {
  if (!globalDb.rewardloopDb) globalDb.rewardloopDb = drizzle(getPool(), { schema });
  return globalDb.rewardloopDb;
}
