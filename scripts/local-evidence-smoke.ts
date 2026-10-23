import { existsSync } from "node:fs";
import { expect, test } from "vitest";
import { reviewWithLocalModel } from "../src/integrations/evidence-review";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const url = process.env.LOCAL_EVIDENCE_URL;
const model = process.env.LOCAL_EVIDENCE_MODEL;
if (!url || !model) throw new Error("Configure LOCAL_EVIDENCE_URL and LOCAL_EVIDENCE_MODEL in ignored .env.local");

const cases = [
  {
    name: "substantive_note",
    rubric: "Explain how a database index improves lookup and one trade-off of adding indexes. Both details must appear in the note.",
    notes: "A database index maps key values to matching rows, so a lookup can avoid scanning every row. The trade-off is that inserts and updates must maintain the index, which costs extra write time and storage.",
  },
  {
    name: "missing_tradeoff",
    rubric: "Explain how a database index improves lookup and one trade-off of adding indexes. Both details must appear in the note.",
    notes: "An index maps a key value to matching rows, allowing the database to find rows without scanning the entire table.",
  },
  {
    name: "duration_claim_only",
    rubric: "Provide independently observable proof that you studied for 30 minutes. A self-reported duration alone does not satisfy this rubric.",
    notes: "I studied for 30 minutes and finished my work, but have no timestamped log or other evidence.",
  },
] as const;

test("real local model reviews three evidence cases", async () => {
  const outcomes: string[] = [];
  for (const item of cases) {
    const result = await reviewWithLocalModel(item, url, model);
    process.stdout.write(JSON.stringify({
      case: item.name, provider: result.provider, model: result.model,
      decision: result.decision, observations: result.observations,
      missingRequirements: result.missingRequirements, confidence: result.confidence,
      reason: result.reason, inputTokens: result.inputTokens, outputTokens: result.outputTokens,
    }) + "\n");
    expect(result.provider).toBe("local_llama");
    expect(result.model).toBe(model);
    outcomes.push(result.decision);
  }
  expect(outcomes[0]).toBe("accepted");
  expect(outcomes.slice(1)).not.toContain("accepted");
});
