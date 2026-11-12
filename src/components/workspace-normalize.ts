import type { NormalizedProduct } from "@/integrations/channel3";

export type WorkspaceShape = {
  user: { name: string; email: string };
  plans: Array<{ plan_id?: string } & Record<string, unknown>>;
  checkins: Array<{ plan_id: string; business_date: string; status: string } & Record<string, unknown>>;
  stats: { totalDays: number };
  services: { catalog: boolean; reviewer: boolean; browser: boolean; reviewerName: string };
};
export type { NormalizedProduct };

/** The API shape can lag behind during a dev reload or partial outage. Never let a missing field crash the workspace. */
export function normalizeWorkspace<W extends WorkspaceShape>(data: unknown): W {
  const raw = (data && typeof data === "object" ? data : {}) as Partial<WorkspaceShape> & Record<string, unknown>;
  if (!raw.user || typeof raw.user !== "object") throw new Error("Your workspace is temporarily unavailable.");
  const plans = Array.isArray(raw.plans) ? raw.plans : [];
  const checkins = Array.isArray(raw.checkins) ? raw.checkins : [];
  const reported = Number((raw.stats as { totalDays?: unknown } | undefined)?.totalDays);
  const fallback = new Set(checkins.filter(c => c?.status === "accepted").map(c => `${c.plan_id}:${c.business_date}`)).size;
  const services = (raw.services && typeof raw.services === "object" ? raw.services : {}) as Partial<WorkspaceShape["services"]>;
  return { user: raw.user, plans, checkins, stats: { totalDays: Number.isFinite(reported) && reported >= 0 ? reported : fallback },
    services: { catalog: services.catalog === true, reviewer: services.reviewer === true, browser: services.browser === true, reviewerName: services.reviewerName || "Gemini" } } as unknown as W;
}
