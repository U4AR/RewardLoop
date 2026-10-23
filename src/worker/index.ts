import { existsSync } from "node:fs";
import { getConfig } from "../config";
import { getPool } from "../db/client";
import { runOneJob, sweepDueGoals } from "./jobs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
getConfig();
console.log("RewardLoop worker started");
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
let lastSweep = 0;
while (!stopping) {
  try {
    if (Date.now() - lastSweep > 30_000) { await sweepDueGoals(); lastSweep = Date.now(); }
    if (!await runOneJob()) await new Promise((resolve) => setTimeout(resolve, 1000));
  } catch (error) {
    console.error("Worker loop error", error instanceof Error ? error.message : "unknown");
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
await getPool().end();
