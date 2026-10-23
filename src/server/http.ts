import { ZodError } from "zod";
import { getConfig } from "../config";
import { DomainError } from "./flow";

export function assertAppMutationOrigin(request: Request): void {
  const expected = new URL(getConfig().APP_ORIGIN);
  if (request.headers.get("host") !== expected.host || request.headers.get("origin") !== expected.origin) {
    throw new DomainError("CROSS_ORIGIN_REQUEST", "Action must come from the RewardLoop app", 403);
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    throw new DomainError("JSON_REQUIRED", "Action requires JSON", 415);
  }
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ZodError) return Response.json({ error: "INVALID_INPUT", details: error.issues.map((i) => i.path.join(".")) }, { status: 400 });
  if (error instanceof DomainError) return Response.json({ error: error.code, message: error.message }, { status: error.httpStatus });
  console.error("Request failed", error instanceof Error ? error.message : "unknown error");
  return Response.json({ error: "INTERNAL_ERROR", message: "Request could not be completed" }, { status: 500 });
}
