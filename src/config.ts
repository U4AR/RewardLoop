import { z } from "zod";
import { kernelStoreOrigin } from "./integrations/kernel-cart";

const envSchema = z.object({
  APP_RUNTIME: z.literal("hackathon").default("hackathon"),
  APP_ORIGIN: z.url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  DATA_ENCRYPTION_KEY: z.string().min(43),
  BETTER_AUTH_URL: z.url().default("http://localhost:3000"),
  ALLOW_LOCAL_SIGNUP: z.enum(["true", "false"]).default("false"),
  ALLOW_FIXTURE_PROVIDERS: z.enum(["true", "false"]).default("false"),
  PAYMENT_PROVIDER: z.literal("paypal_sandbox").default("paypal_sandbox"),
  PAYPAL_ENV: z.literal("sandbox").default("sandbox"),
  PAYPAL_API_BASE_URL: z.literal("https://api-m.sandbox.paypal.com").default("https://api-m.sandbox.paypal.com"),
  PAYPAL_SANDBOX_CLIENT_ID: z.string().optional(),
  PAYPAL_SANDBOX_CLIENT_SECRET: z.string().optional(),
  PAYPAL_SANDBOX_MERCHANT_ID: z.string().optional(),
  PAYPAL_SANDBOX_WEBHOOK_ID: z.string().optional(),
  CHANNEL3_API_KEY: z.string().optional(),
  KERNEL_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  EVIDENCE_MODEL: z.string().optional(),
  LOCAL_EVIDENCE_URL: z.preprocess((value) => value === "" ? undefined : value, z.url().optional()),
  LOCAL_EVIDENCE_MODEL: z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).max(120).optional()),
  SHOPPING_MODEL: z.string().optional(),
  MOCK_STORE_ORIGIN: z.preprocess((value) => value === "" ? undefined : value, z.url().optional()),
  BUSINESS_CLOCK_MODE: z.enum(["real", "operator_demo"]).default("real"),
});

export type AppConfig = z.infer<typeof envSchema>;
let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid application configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  if (parsed.data.MOCK_STORE_ORIGIN && parsed.data.KERNEL_API_KEY &&
      new URL(parsed.data.MOCK_STORE_ORIGIN).origin === new URL(parsed.data.APP_ORIGIN).origin) {
    throw new Error("Kernel mode requires a distinct mock-store origin from the app/admin origin");
  }
  if (parsed.data.ALLOW_FIXTURE_PROVIDERS === "true" && new URL(parsed.data.APP_ORIGIN).hostname !== "localhost") {
    throw new Error("Fixture providers are restricted to localhost");
  }
  if (Boolean(parsed.data.LOCAL_EVIDENCE_URL) !== Boolean(parsed.data.LOCAL_EVIDENCE_MODEL)) {
    throw new Error("Local evidence review requires both LOCAL_EVIDENCE_URL and LOCAL_EVIDENCE_MODEL");
  }
  if (parsed.data.LOCAL_EVIDENCE_URL) {
    const local = new URL(parsed.data.LOCAL_EVIDENCE_URL);
    if (local.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(local.hostname) ||
        local.username || local.password || local.search || local.hash || local.pathname !== "/v1/chat/completions") {
      throw new Error("Local evidence review must use the loopback llama.cpp chat completions endpoint");
    }
  }
  cached = parsed.data;
  return cached;
}

export function providerMode(config: AppConfig) {
  let kernelAvailable = false;
  if (config.KERNEL_API_KEY) {
    try { kernelStoreOrigin(config.MOCK_STORE_ORIGIN, config.APP_ORIGIN); kernelAvailable = true; }
    catch { /* A local or shared store cannot be used from a Kernel browser. */ }
  }
  return {
    catalog: config.CHANNEL3_API_KEY ? "channel3" : "fixture",
    evidence: config.ANTHROPIC_API_KEY && config.EVIDENCE_MODEL ? "anthropic" :
      config.LOCAL_EVIDENCE_URL && config.LOCAL_EVIDENCE_MODEL ? "local_llama" : "fixture",
    browser: kernelAvailable ? "Kernel cart preparation available" : "direct mock store",
    payment: config.PAYPAL_SANDBOX_CLIENT_ID && config.PAYPAL_SANDBOX_CLIENT_SECRET ? "paypal_sandbox" : "fixture or blocked",
  } as const;
}
