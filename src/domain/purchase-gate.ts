import { dateWithin } from "./clock";

export type GateCode =
  | "LIVE_PAYMENT_FORBIDDEN" | "WRONG_OWNER" | "GOAL_NOT_QUALIFIED" | "GOAL_VERSION_CHANGED"
  | "PERMISSION_INACTIVE" | "WINDOW_CLOSED" | "ALREADY_PURCHASED" | "WRONG_STATE"
  | "WRONG_SKU" | "WRONG_VARIANT" | "WRONG_SELLER" | "WRONG_QUANTITY" | "WRONG_CURRENCY"
  | "WRONG_DESTINATION" | "OVER_CAP" | "STALE_QUOTE" | "EXTRA_ITEMS"
  | "PAYMENT_NOT_READY" | "LEASE_LOST";

export type GateInput = {
  runtime: "hackathon";
  paymentHost: string;
  actorUserId: string;
  intentUserId: string;
  goal: { version: number; rubricVersion: number; qualified: boolean; status: string };
  permission: {
    userId: string;
    goalVersion: number;
    rubricVersion: number;
    status: string;
    primarySku: string;
    alternativeSkus: string[];
    approvedVariants: Record<string, string>;
    seller: string;
    quantity: number;
    currency: string;
    destinationId: string;
    totalCapMinor: number;
    earliestDate: string;
    latestDate: string;
    unattendedSandboxApproved: boolean;
    executionMode: "fixture" | "paypal_sandbox" | "paypal_sandbox_fresh";
  };
  intent: { state: string; captureId?: string | null; leaseValid: boolean };
  quote: {
    sku: string;
    variant: string;
    seller: string;
    quantity: number;
    currency: string;
    destinationId: string;
    totalMinor: number;
    fresh: boolean;
    inventoryVersionMatches: boolean;
    extraItems: boolean;
  };
  businessDate: string;
  paymentConnectionReady: boolean;
  sandboxMerchantReady?: boolean;
  fixtureModeAllowed: boolean;
};

export function evaluatePurchaseGate(input: GateInput): { allowed: true } | { allowed: false; code: GateCode } {
  const deny = (code: GateCode) => ({ allowed: false as const, code });
  if (input.runtime !== "hackathon" || input.paymentHost !== "https://api-m.sandbox.paypal.com") return deny("LIVE_PAYMENT_FORBIDDEN");
  if (!["fixture", "paypal_sandbox", "paypal_sandbox_fresh"].includes(input.permission.executionMode)) return deny("PAYMENT_NOT_READY");
  if (input.actorUserId !== input.intentUserId || input.permission.userId !== input.intentUserId) return deny("WRONG_OWNER");
  if (input.goal.version !== input.permission.goalVersion || input.goal.rubricVersion !== input.permission.rubricVersion) return deny("GOAL_VERSION_CHANGED");
  if (input.goal.status !== "ACTIVE" || input.permission.status !== "ACTIVE") return deny("PERMISSION_INACTIVE");
  if (!input.goal.qualified) return deny("GOAL_NOT_QUALIFIED");
  if (!dateWithin(input.businessDate, input.permission.earliestDate, input.permission.latestDate)) return deny("WINDOW_CLOSED");
  if (input.intent.captureId) return deny("ALREADY_PURCHASED");
  if (input.intent.state !== "READY_TO_COMMIT") return deny("WRONG_STATE");
  if (!input.intent.leaseValid) return deny("LEASE_LOST");
  if (![input.permission.primarySku, ...input.permission.alternativeSkus].includes(input.quote.sku)) return deny("WRONG_SKU");
  if (input.quote.variant !== input.permission.approvedVariants[input.quote.sku]) return deny("WRONG_VARIANT");
  if (input.quote.seller !== input.permission.seller) return deny("WRONG_SELLER");
  if (input.quote.quantity !== input.permission.quantity) return deny("WRONG_QUANTITY");
  if (input.quote.currency !== input.permission.currency || input.quote.currency !== "USD") return deny("WRONG_CURRENCY");
  if (input.quote.destinationId !== input.permission.destinationId) return deny("WRONG_DESTINATION");
  if (input.quote.extraItems) return deny("EXTRA_ITEMS");
  if (!input.quote.fresh || !input.quote.inventoryVersionMatches) return deny("STALE_QUOTE");
  if (!Number.isSafeInteger(input.quote.totalMinor) || input.quote.totalMinor < 0 || input.quote.totalMinor > input.permission.totalCapMinor) return deny("OVER_CAP");
  if (input.permission.executionMode === "fixture" && !input.fixtureModeAllowed) return deny("PAYMENT_NOT_READY");
  if (input.permission.executionMode === "paypal_sandbox" && (!input.permission.unattendedSandboxApproved || !input.paymentConnectionReady)) return deny("PAYMENT_NOT_READY");
  if (input.permission.executionMode === "paypal_sandbox_fresh" && !input.sandboxMerchantReady) return deny("PAYMENT_NOT_READY");
  return { allowed: true };
}
