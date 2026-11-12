import type { Pool, PoolClient } from "pg";
import { reviewerPolicyFromPermission, type ReviewerPolicy } from "../domain/reviewer-policy";

/** A legacy fixture row cannot claim a day after the approved real reviewer accepts it. */
export async function recordQualifyingDay(db: PoolClient, input: {
  goalId: string;
  goalVersion: number;
  rubricVersion: number;
  businessDate: string | Date;
  evidenceId: string;
}, reviewer: ReviewerPolicy): Promise<void> {
  await db.query(
    `INSERT INTO daily_qualifications (goal_id,goal_version,rubric_version,local_date,evidence_id)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (goal_id,goal_version,rubric_version,local_date)
     DO UPDATE SET evidence_id = EXCLUDED.evidence_id
     WHERE EXISTS (
       SELECT 1 FROM evidence_submissions prior
       WHERE prior.id = daily_qualifications.evidence_id AND (
         prior.review_provider IS DISTINCT FROM $6 OR prior.review_model IS DISTINCT FROM $7
         OR prior.status <> 'ACCEPTED'))`,
    [input.goalId, input.goalVersion, input.rubricVersion, input.businessDate, input.evidenceId,
      reviewer.provider, reviewer.model],
  );
}

/** Every purchase path counts the same owner-approved reviewer and exact model. */
export async function countQualifyingDays(db: Pool | PoolClient, goal: Record<string, unknown>, permission: Record<string, unknown>): Promise<number> {
  const reviewer = reviewerPolicyFromPermission(permission);
  if (!reviewer || permission.goal_version !== goal.goal_version ||
      permission.rubric_version !== goal.rubric_version || permission.status !== "ACTIVE") return 0;
  const result = await db.query(
    `SELECT COUNT(*)::int AS n FROM daily_qualifications dq
     JOIN evidence_submissions e ON e.id = dq.evidence_id
     WHERE dq.goal_id = $1 AND dq.goal_version = $2 AND dq.rubric_version = $3
       AND dq.local_date >= $4 AND dq.local_date < $5
       AND e.goal_id = dq.goal_id AND e.goal_version = dq.goal_version
       AND e.rubric_version = dq.rubric_version AND e.business_date = dq.local_date
       AND e.user_id = $6 AND e.status = 'ACCEPTED'
       AND e.review_provider = $7 AND e.review_model = $8`,
    [goal.id, goal.goal_version, goal.rubric_version, goal.start_date, goal.end_date_exclusive,
      permission.user_id, reviewer.provider, reviewer.model],
  );
  return Number(result.rows[0]?.n ?? 0);
}
