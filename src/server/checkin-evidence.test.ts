import { describe, expect, it } from "vitest";
import { evidenceMedia, evidenceSchema } from "./workspace";

const planId = "6f1c1d3e-8f5a-4a5b-9a51-3c1f4e9d2b10";
const b64 = (n: number) => Buffer.alloc(n, 7).toString("base64");

describe("check-in evidence", () => {
  it("needs 30 characters for a written check-in, and media for photo or voice", () => {
    expect(evidenceSchema.safeParse({ planId, kind: "text", notes: "too short" }).success).toBe(false);
    expect(evidenceSchema.safeParse({ planId, kind: "text", notes: "x".repeat(30) }).success).toBe(true);
    expect(evidenceSchema.safeParse({ planId, kind: "photo", notes: "" }).success).toBe(false);
    expect(evidenceSchema.safeParse({ planId, kind: "voice", media: { mimeType: "audio/webm", base64: b64(500) } }).success).toBe(true);
    expect(evidenceSchema.safeParse({ planId, kind: "text", notes: "x".repeat(30), media: { mimeType: "image/png", base64: b64(500) } }).success).toBe(false);
  });

  it("accepts only known photo and audio types within 8 MB", () => {
    const parse = (raw: unknown) => evidenceMedia(evidenceSchema.parse(raw));
    expect(parse({ planId, kind: "photo", media: { mimeType: "image/jpeg", base64: b64(2000) } })?.bytes.length).toBe(2000);
    expect(parse({ planId, kind: "voice", media: { mimeType: "audio/webm;codecs=opus", base64: b64(2000) } })?.mimeType).toBe("audio/webm");
    expect(() => parse({ planId, kind: "photo", media: { mimeType: "image/svg+xml", base64: b64(2000) } })).toThrow(/JPEG, PNG or WebP/);
    expect(() => parse({ planId, kind: "voice", media: { mimeType: "video/mp4", base64: b64(2000) } })).toThrow(/not supported/);
    expect(() => parse({ planId, kind: "photo", media: { mimeType: "image/png", base64: b64(50) } })).toThrow(/empty/);
    expect(() => parse({ planId, kind: "photo", media: { mimeType: "image/png", base64: "not base64!!" } })).toThrow(/could not be read/);
    expect(() => parse({ planId, kind: "photo", media: { mimeType: "image/png", base64: b64(8 * 1024 * 1024 + 10) } })).toThrow(/under 8 MB/);
  });
});
