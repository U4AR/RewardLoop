import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn(), config: vi.fn() }));
vi.mock("../db/client", () => ({ getPool: () => ({ connect: mocks.connect }) }));
vi.mock("../config", () => ({ getConfig: mocks.config }));

import { createPermission, DomainError, revokePermission } from "./flow";

const permissionId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
  mocks.config.mockReturnValue({
    PAYPAL_SANDBOX_CLIENT_ID: "sandbox-id", PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-secret",
    PAYPAL_SANDBOX_MERCHANT_ID: "sandbox-merchant", LOCAL_EVIDENCE_URL: "http://127.0.0.1:8082/v1/chat/completions",
    LOCAL_EVIDENCE_MODEL: "Qwen3-1.7B-Q4_K_M", ALLOW_FIXTURE_PROVIDERS: "false",
  });
});

const permissionInput = {
  goalId: "00000000-0000-4000-8000-000000000001", primarySku: "SKU-1", alternativeSkus: [],
  totalCapMinor: 4000, earliestDate: "2026-10-24", latestDate: "2026-11-01",
  expectedSeller: "RewardLoop Demo Store", expectedVariants: { "SKU-1": "navy" },
  expectedMode: "paypal_sandbox_fresh", expectedReviewerProvider: "local_llama",
  expectedReviewerModel: "Qwen3-1.7B-Q4_K_M", ownerConfirmed: true,
};

function mockPermissionTransaction() {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT * FROM goals")) return { rows: [{ id: permissionInput.goalId, status: "ACTIVE",
      goal_version: 1, rubric_version: 1, cycle_id: "cycle-1" }], rowCount: 1 };
    if (sql.includes("SELECT id FROM purchase_permissions")) return { rows: [], rowCount: 0 };
    if (sql.includes("SELECT * FROM demo_products")) return { rows: [{ sku: "SKU-1", variant: "navy",
      seller: "RewardLoop Demo Store" }], rowCount: 1 };
    if (sql.includes("INSERT INTO purchase_permissions")) return { rows: [{ id: "permission-1" }], rowCount: 1 };
    if (sql.includes("INSERT INTO purchase_intents")) return { rows: [{ id: "intent-1" }], rowCount: 1 };
    return { rows: [], rowCount: 1 };
  });
}

describe("Sandbox permission reviewer consent", () => {
  it("rejects a reviewer change between display and approval before saving", async () => {
    mockPermissionTransaction();
    await expect(createPermission("owner-1", { ...permissionInput, expectedReviewerModel: "different-model" }))
      .rejects.toMatchObject({ code: "PURCHASE_TERMS_CHANGED" });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO purchase_permissions"))).toBe(false);
  });

  it("rejects a changed variant before saving the owner's purchase permission", async () => {
    mockPermissionTransaction();
    await expect(createPermission("owner-1", { ...permissionInput, expectedVariants: { "SKU-1": "red" } }))
      .rejects.toMatchObject({ code: "PURCHASE_TERMS_CHANGED" });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO purchase_permissions"))).toBe(false);
  });

  it("pins the approved genuine local reviewer on a Sandbox permission", async () => {
    mockPermissionTransaction();
    await createPermission("owner-1", permissionInput);
    const insert = mocks.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO purchase_permissions"));
    expect(insert?.[1]).toContain("paypal_sandbox_fresh");
    expect(insert?.[1]).toContain("local_llama");
    expect(insert?.[1]).toContain("Qwen3-1.7B-Q4_K_M");
  });

  it("cannot approve Sandbox using only the deterministic fixture reviewer", async () => {
    mockPermissionTransaction();
    mocks.config.mockReturnValue({ PAYPAL_SANDBOX_CLIENT_ID: "sandbox-id", PAYPAL_SANDBOX_CLIENT_SECRET: "sandbox-secret",
      PAYPAL_SANDBOX_MERCHANT_ID: "sandbox-merchant", ALLOW_FIXTURE_PROVIDERS: "true" });
    await expect(createPermission("owner-1", { ...permissionInput, expectedReviewerProvider: "fixture",
      expectedReviewerModel: "deterministic-word-count-v1" }))
      .rejects.toMatchObject({ code: "EVIDENCE_MODEL_REQUIRED" });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO purchase_permissions"))).toBe(false);
  });
});

describe("purchase permission revocation", () => {
  it("revokes only the authenticated user's active permission and records one audit event", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE purchase_permissions")) return { rowCount: 1, rows: [{ id: permissionId, status: "REVOKED" }] };
      return { rowCount: 1, rows: [] };
    });

    await expect(revokePermission("user-1", { permissionId })).resolves.toEqual({ permissionId, status: "REVOKED" });

    const update = mocks.query.mock.calls.find(([sql]) => String(sql).includes("UPDATE purchase_permissions"));
    expect(update?.[0]).toContain("id = $1 AND user_id = $2 AND status = 'ACTIVE'");
    expect(update?.[1]).toEqual([permissionId, "user-1"]);
    expect(mocks.query.mock.calls.filter(([sql]) => String(sql).includes("PERMISSION_REVOKED"))).toHaveLength(1);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("allows an idempotent repeat without creating another audit event", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE purchase_permissions")) return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT status FROM purchase_permissions")) return { rowCount: 1, rows: [{ status: "REVOKED" }] };
      return { rowCount: 1, rows: [] };
    });

    await expect(revokePermission("user-1", { permissionId })).resolves.toEqual({ permissionId, status: "REVOKED" });
    expect(mocks.query.mock.calls.some(([sql]) => String(sql).includes("PERMISSION_REVOKED"))).toBe(false);
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });

  it("does not reveal or change another user's permission", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("UPDATE purchase_permissions")) return { rowCount: 0, rows: [] };
      if (sql.includes("SELECT status FROM purchase_permissions")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [] };
    });

    await expect(revokePermission("other-user", { permissionId })).rejects.toMatchObject<Partial<DomainError>>({ code: "PERMISSION_NOT_FOUND", httpStatus: 404 });
    expect(mocks.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(mocks.release).toHaveBeenCalledOnce();
  });
});
