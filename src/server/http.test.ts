import { beforeEach, describe, expect, it, vi } from "vitest";
import { getConfig } from "../config";
import { assertAppMutationOrigin } from "./http";

vi.mock("../config", () => ({ getConfig: vi.fn() }));

beforeEach(() => {
  vi.mocked(getConfig).mockReturnValue({ APP_ORIGIN: "https://app.rewardloop.test" } as ReturnType<typeof getConfig>);
});

function mutation(host: string, origin: string, contentType = "application/json") {
  return new Request("https://app.rewardloop.test/api/goals", {
    method: "POST",
    headers: { host, origin, "content-type": contentType },
  });
}

describe("app mutation boundary", () => {
  it("accepts JSON only from the configured app host and origin", () => {
    expect(() => assertAppMutationOrigin(mutation("app.rewardloop.test", "https://app.rewardloop.test"))).not.toThrow();
    expect(() => assertAppMutationOrigin(mutation("store.rewardloop.test", "https://store.rewardloop.test"))).toThrow(/RewardLoop app/);
    expect(() => assertAppMutationOrigin(mutation("app.rewardloop.test", "https://store.rewardloop.test"))).toThrow(/RewardLoop app/);
    expect(() => assertAppMutationOrigin(mutation("app.rewardloop.test", "https://app.rewardloop.test", "text/plain"))).toThrow(/requires JSON/);
  });
});
