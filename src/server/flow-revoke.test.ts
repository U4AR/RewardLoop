import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock("../db/client", () => ({ getPool: () => ({ connect: mocks.connect }) }));

import { DomainError, revokePermission } from "./flow";

const permissionId = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({ query: mocks.query, release: mocks.release });
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
