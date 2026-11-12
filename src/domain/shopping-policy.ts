import { createHash } from "node:crypto";

/** A private delivery destination. Stored encrypted; only a masked label leaves the server. */
export type Destination = {
  fullName: string; line1: string; line2?: string; city: string; region: string; postalCode: string; country: string;
  /** Optional delivery phone; many stores require one at checkout. Not part of the fingerprint. */
  phone?: string;
};

export type PurchaseAuthorization = {
  id: string; productId: string; productTitle: string; variantLabel: string; merchant: string; quantity: number;
  destinationFingerprint: string; destinationLabel: string; paymentLabel: string; paymentConnectionId?: string; currency: "USD";
  totalCapMinor: number; validFrom: string; validUntil: string; mode: "dry_run" | "live"; status: "active" | "revoked" | "consumed";
};

/** What the agent observed on the retailer's checkout review page (extracted by the model, then checked by code). */
export type CheckoutObservation = {
  pageUrl: string;
  items: Array<{ title: string; variant: string | null; quantity: number | null; matchesApprovedItem: boolean }>;
  subtotalMinor: number | null; shippingMinor: number | null; taxMinor: number | null; totalMinor: number | null;
  currency: string | null; shipToText: string | null; paymentText: string | null; placeOrderVisible: boolean;
};

export type CheckoutValidation = { ok: boolean; reasons: string[]; checkedAt: string };

const norm = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function normalizeDestination(input: Destination): Destination {
  const clean = (v: string | undefined, max: number) => (v ?? "").normalize("NFKC").replace(/\s+/g, " ").trim().slice(0, max);
  return { fullName: clean(input.fullName, 120), line1: clean(input.line1, 160), line2: clean(input.line2, 160) || undefined,
    city: clean(input.city, 80), region: clean(input.region, 80), postalCode: clean(input.postalCode, 20).toUpperCase(), country: clean(input.country, 2).toUpperCase(),
    ...(clean(input.phone, 30) ? { phone: clean(input.phone, 30) } : {}) };
}

/** Changes to street, postal code or country change the fingerprint, so a new purchase approval is required. */
export function destinationFingerprint(input: Destination): string {
  const d = normalizeDestination(input);
  return createHash("sha256").update([norm(d.line1), norm(d.line2 ?? ""), norm(d.postalCode), d.country].join("|")).digest("hex");
}

/** A label that is safe to show, store unencrypted and put in a video: no name, no street. */
export function maskedDestinationLabel(input: Destination): string {
  const d = normalizeDestination(input);
  const zip = d.postalCode.replace(/\s/g, "");
  return `${d.city ? d.city + ", " : ""}${d.region ? d.region + " " : ""}${zip.length > 2 ? "•••" + zip.slice(-2) : "•••"} (${d.country})`;
}

/** The ship-to block at checkout must contain the approved postal code, house number and a street word. */
export function shipToMatches(destination: Destination, shipToText: string | null): boolean {
  if (!shipToText) return false;
  const d = normalizeDestination(destination);
  const text = ` ${norm(shipToText)} `;
  const zip = norm(d.postalCode).replace(/\s/g, "");
  if (!zip || !text.replace(/\s/g, "").includes(zip)) return false;
  const words = norm(d.line1).split(" ").filter(Boolean);
  const number = words.find(w => /\d/.test(w));
  const street = words.filter(w => !/\d/.test(w) && w.length > 2 && !["street", "st", "road", "rd", "avenue", "ave", "lane", "ln", "drive", "dr", "apt", "unit", "suite"].includes(w));
  if (number && !text.includes(` ${number} `)) return false;
  return street.length === 0 || street.some(w => text.includes(` ${w} `));
}

export function paymentMatches(label: string, paymentText: string | null): boolean {
  if (!paymentText) return false;
  const want = norm(label), have = norm(paymentText);
  const last4 = want.match(/\b(\d{4})\b/)?.[1];
  if (last4) return have.includes(last4);
  if (want.includes("paypal")) return have.includes("paypal");
  return want.length > 2 && have.includes(want);
}

/** Text the agent must never click while preparing a purchase. Only the guarded final step may submit an order. */
const ORDER_SUBMIT = /\b(place (your )?order|submit order|complete (your )?(order|purchase)|confirm (and pay|order|purchase)|pay now|buy now|buy it now|1-click|one-click|purchase now|pay \$|pay with)\b/i;
const NEVER = /\b(subscribe|subscription|sign up for|apply now|open (a|an) (card|account)|get the card|delete|remove account|sign out|log out|change (address|payment)|edit (address|payment)|add (a )?(new )?(address|card|payment))\b/i;

export function isOrderSubmitControl(text: string): boolean { return ORDER_SUBMIT.test(text); }
const CONSENT_ACCEPT = /^(accept|allow|agree|i agree|i accept|accept (all|cookies|all cookies)|allow (all|cookies|all cookies)|agree (and|&) (continue|close)|accept (and|&) (continue|close))$/i;

export function forbiddenForAgent(text: string): string | null {
  if (CONSENT_ACCEPT.test(text.trim())) return "Accepting cookies or terms is the user's decision. Decline non-essential cookies or close the banner instead.";
  if (NEVER.test(text)) return "This control could change the user's account, address, payment or subscriptions.";
  if (ORDER_SUBMIT.test(text)) return "Order submission is reserved for the guarded final step.";
  return null;
}

/**
 * Code, not the model, decides whether a checkout may proceed. Every check must pass, and missing data fails closed.
 * The observation must show exactly one approved item, quantity one, USD, an all-in total within the cap, the approved
 * destination and payment method, inside the approval window, for an earned goal and an active approval.
 */
export function validateCheckout(input: {
  authorization: PurchaseAuthorization; destination: Destination | null; goalEarned: boolean; observation: CheckoutObservation; now?: Date;
}): CheckoutValidation {
  const { authorization: a, destination, observation: o } = input;
  const now = input.now ?? new Date();
  const reasons: string[] = [];
  if (a.status !== "active") reasons.push("The purchase approval is no longer active.");
  if (now < new Date(a.validFrom) || now > new Date(a.validUntil)) reasons.push("The approval window has closed or not yet opened.");
  if (!input.goalEarned) reasons.push("The goal has not been earned yet.");
  let host = "";
  try { host = new URL(o.pageUrl).hostname.replace(/^www\./, "").toLowerCase(); } catch { /* fails below */ }
  const merchant = a.merchant.replace(/^www\./, "").toLowerCase();
  if (!host || (host !== merchant && !host.endsWith(`.${merchant}`))) reasons.push(`Checkout is on ${host || "an unknown site"}, not the approved merchant ${a.merchant}.`);
  if (!o.placeOrderVisible) reasons.push("A final checkout review page must be visible before a Sandbox payment.");
  if (o.items.length !== 1) reasons.push(`The cart must contain exactly the approved item; found ${o.items.length} line item(s).`);
  const item = o.items[0];
  if (item && !item.matchesApprovedItem) reasons.push("The cart item does not match the approved product.");
  if (item && a.variantLabel && a.variantLabel !== "Default") {
    const shown = ` ${norm(`${item.variant ?? ""} ${item.title}`)} `;
    const values = a.variantLabel.split(",").map(part => norm(part.split(":").pop() ?? "")).filter(Boolean);
    if (!values.every(value => shown.includes(` ${value} `))) reasons.push(`The variant could not be confirmed as "${a.variantLabel}".`);
  }
  if (item && item.quantity !== a.quantity) reasons.push(`Quantity must be ${a.quantity}; checkout shows ${item.quantity ?? "an unknown quantity"}.`);
  if (o.currency !== a.currency) reasons.push(`Currency must be ${a.currency}; checkout shows ${o.currency ?? "unknown"}.`);
  if (o.subtotalMinor === null || o.totalMinor === null || o.totalMinor <= 0 || (o.subtotalMinor !== null && o.shippingMinor !== null && o.taxMinor !== null && o.totalMinor !== o.subtotalMinor + o.shippingMinor + o.taxMinor)) reasons.push("The subtotal, shipping, tax and total must add up exactly.");
  if (o.totalMinor === null) reasons.push("The all-in total (including shipping and tax) could not be read.");
  else if (o.totalMinor > a.totalCapMinor) reasons.push(`The all-in total ${(o.totalMinor / 100).toFixed(2)} exceeds the approved cap ${(a.totalCapMinor / 100).toFixed(2)}.`);
  // Some destinations (e.g. Oregon) have no sales tax and stores show no tax line. That is only acceptable when the
  // shown total equals subtotal + shipping exactly, so nothing can be hidden; the cap is always checked on the total.
  const noTaxLine = o.taxMinor === null && o.subtotalMinor !== null && o.shippingMinor !== null && o.totalMinor === o.subtotalMinor + o.shippingMinor;
  if (o.shippingMinor === null || (o.taxMinor === null && !noTaxLine)) reasons.push("Shipping and tax must be shown before the total can be trusted.");
  if (!destination) reasons.push("No private delivery destination is saved.");
  else if (destinationFingerprint(destination) !== a.destinationFingerprint) reasons.push("The saved delivery destination changed after approval. Approve again.");
  else if (!shipToMatches(destination, o.shipToText)) reasons.push("The retailer's ship-to address does not match the approved destination.");
  if (!a.paymentConnectionId && !paymentMatches(a.paymentLabel, o.paymentText)) reasons.push(`The payment method could not be confirmed as "${a.paymentLabel}".`);
  return { ok: reasons.length === 0, reasons, checkedAt: now.toISOString() };
}

/** A receipt counts only if it names an order, matches the merchant and stays within the cap. Anything else is unknown. */
export function verifyReceipt(a: PurchaseAuthorization, receipt: { pageUrl: string; orderNumber: string | null; totalMinor: number | null; confirmed: boolean }): boolean {
  let host = "";
  try { host = new URL(receipt.pageUrl).hostname.replace(/^www\./, ""); } catch { return false; }
  const merchant = a.merchant.replace(/^www\./, "");
  return receipt.confirmed && !!receipt.orderNumber && /^[A-Za-z0-9-]{4,40}$/.test(receipt.orderNumber) &&
    (host === merchant || host.endsWith(`.${merchant}`)) && receipt.totalMinor !== null && receipt.totalMinor <= a.totalCapMinor;
}

export const OPEN_ATTEMPT_STATES = ["queued", "running", "needs_handoff", "unknown"] as const;
export const TERMINAL_ATTEMPT_STATES = ["dry_run_passed", "blocked", "purchased", "cancelled", "reconciled_no_order", "reported_purchased"] as const;
