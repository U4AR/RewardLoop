import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { getPool } from "../src/db/client";
import { countQualifyingDays, recordQualifyingDay } from "../src/server/qualification";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const pool = getPool();
const db = await pool.connect();
let begun = false;
try {
  await db.query("BEGIN");
  begun = true;
  const owner = `review-smoke-${randomUUID()}`;
  const goalResult = await db.query(
    `INSERT INTO goals (user_id,title,rubric,timezone,start_date,end_date_exclusive,required_days)
     VALUES ($1,'Reviewer policy smoke','Describe two learned concepts','UTC','2026-10-01','2026-11-01',1)
     RETURNING id,goal_version,rubric_version,start_date,end_date_exclusive`, [owner],
  );
  const goal = goalResult.rows[0];
  const insertEvidence = async (provider: string, model: string) => (await db.query(
    `INSERT INTO evidence_submissions
      (user_id,goal_id,goal_version,rubric_version,business_date,notes,content_hash,status,review_provider,review_model)
     VALUES ($1,$2,$3,$4,'2026-10-24','Smoke test note',$5,'ACCEPTED',$6,$7) RETURNING id`,
    [owner, goal.id, goal.goal_version, goal.rubric_version, randomUUID(), provider, model],
  )).rows[0].id as string;
  const fixtureId = await insertEvidence("fixture", "deterministic-word-count-v1");
  const localId = await insertEvidence("local_llama", "Qwen3-1.7B-Q4_K_M");
  const day = { goalId: goal.id, goalVersion: goal.goal_version, rubricVersion: goal.rubric_version,
    businessDate: "2026-10-24", evidenceId: fixtureId };
  await recordQualifyingDay(db, day, { provider: "fixture", model: "deterministic-word-count-v1" });
  const permission = { user_id: owner, status: "ACTIVE", execution_mode: "paypal_sandbox_fresh",
    goal_version: goal.goal_version, rubric_version: goal.rubric_version,
    review_provider: "local_llama", review_model: "Qwen3-1.7B-Q4_K_M" };
  assert.equal(await countQualifyingDays(db, goal, permission), 0);
  await recordQualifyingDay(db, { ...day, evidenceId: localId },
    { provider: "local_llama", model: "Qwen3-1.7B-Q4_K_M" });
  assert.equal(await countQualifyingDays(db, goal, permission), 1);
  const recorded = await db.query("SELECT evidence_id FROM daily_qualifications WHERE goal_id = $1", [goal.id]);
  assert.equal(recorded.rows[0].evidence_id, localId);
  await db.query("ROLLBACK");
  begun = false;
  console.log("Reviewer qualification SQL smoke passed; transaction rolled back.");
} finally {
  if (begun) await db.query("ROLLBACK");
  db.release();
  await pool.end();
}
