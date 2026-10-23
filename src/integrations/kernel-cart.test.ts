import { describe, expect, it, vi } from "vitest";
import type Kernel from "@onkernel/sdk";
import { kernelStoreOrigin, runKernelTwoSessionCart } from "./kernel-cart";

const cart = {
  accountSessionId: "11111111-1111-4111-8111-111111111111",
  sku: "FOCUS-1", destinationId: "demo-us-address", syntheticOnly: true,
  checkoutEnabled: false, shipment: false,
};

const input = {
  apiKey: "fake-test-key", appOrigin: "https://app.rewardloop-demo.com",
  storeOrigin: "https://store.rewardloop-demo.com", storeSessionId: cart.accountSessionId,
  setupCode: "ABCDEFGHIJKLMNOPQRSTUVWX", sku: cart.sku,
};

function fakeKernel() {
  const createProfile = vi.fn(async () => ({ id: "profile" }));
  const deleteProfile = vi.fn(async () => undefined);
  const createBrowser = vi.fn()
    .mockResolvedValueOnce({ session_id: "writer-1", browser_live_view_url: "secret-capability" })
    .mockResolvedValueOnce({ session_id: "reader-2", browser_live_view_url: "secret-capability" });
  const deleteBrowser = vi.fn(async (_id: string) => undefined);
  const execute = vi.fn()
    .mockResolvedValueOnce({ success: true, result: cart })
    .mockResolvedValueOnce({ success: true, result: cart });
  const client = { profiles: { create: createProfile, delete: deleteProfile },
    browsers: { create: createBrowser, deleteByID: deleteBrowser, playwright: { execute } } } as unknown as Kernel;
  return { client, createProfile, deleteProfile, createBrowser, deleteBrowser, execute };
}

describe("Kernel saved-cart browser boundary", () => {
  it("rejects a missing key and local or shared store origins before any provider call", async () => {
    const fake = fakeKernel();
    await expect(runKernelTwoSessionCart({ ...input, apiKey: undefined }, fake.client))
      .rejects.toMatchObject({ code: "KERNEL_KEY_REQUIRED" });
    await expect(runKernelTwoSessionCart({ ...input, storeOrigin: "http://localhost:3000" }, fake.client))
      .rejects.toMatchObject({ code: "PUBLIC_HTTPS_STORE_REQUIRED" });
    await expect(runKernelTwoSessionCart({ ...input, storeOrigin: input.appOrigin }, fake.client))
      .rejects.toMatchObject({ code: "PUBLIC_HTTPS_STORE_REQUIRED" });
    expect(fake.createProfile).not.toHaveBeenCalled();
    expect(() => kernelStoreOrigin("https://10.0.0.4", input.appOrigin)).toThrow();
  });

  it("saves the cart, closes the writer, restores a distinct read-only browser, and cleans up", async () => {
    const fake = fakeKernel();
    const result = await runKernelTwoSessionCart(input, fake.client);
    expect(result).toEqual({ writerSessionId: "writer-1", readerSessionId: "reader-2",
      storeSessionId: cart.accountSessionId, sku: cart.sku });
    expect(fake.createBrowser).toHaveBeenCalledTimes(2);
    expect(fake.createBrowser.mock.calls[0][0]).toMatchObject({
      profile: { save_changes: true }, start_url: "https://store.rewardloop-demo.com/store",
      network: { allowed_hosts: ["store.rewardloop-demo.com"], private_hosts: [] },
    });
    expect(fake.createBrowser.mock.calls[1][0]).toMatchObject({ profile: { save_changes: false } });
    expect(fake.deleteBrowser.mock.calls.map((call) => call[0])).toEqual(["writer-1", "reader-2"]);
    expect(fake.deleteProfile).toHaveBeenCalledOnce();
    expect(fake.execute.mock.calls[0][1].code).toContain("Sign in to demo store");
    expect(fake.execute.mock.calls[1][1].code).not.toContain(input.setupCode);
  });

  it("does not accept a restored cart from another store session and still cleans up", async () => {
    const fake = fakeKernel();
    fake.execute.mockReset()
      .mockResolvedValueOnce({ success: true, result: cart })
      .mockResolvedValueOnce({ success: true, result: { ...cart, accountSessionId: "other-owner-session" } });
    await expect(runKernelTwoSessionCart(input, fake.client))
      .rejects.toMatchObject({ code: "KERNEL_RESTORED_CART_MISMATCH" });
    expect(fake.deleteBrowser.mock.calls.map((call) => call[0])).toEqual(["writer-1", "reader-2"]);
    expect(fake.deleteProfile).toHaveBeenCalledOnce();
  });

  it("fails closed if a saved browser profile cannot be deleted", async () => {
    const fake = fakeKernel();
    fake.deleteProfile.mockRejectedValueOnce(new Error("provider detail must not leak"));
    await expect(runKernelTwoSessionCart(input, fake.client))
      .rejects.toMatchObject({ code: "KERNEL_CLEANUP_UNCONFIRMED" });
  });
});
