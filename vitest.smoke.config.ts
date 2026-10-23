import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["scripts/local-evidence-smoke.ts"], testTimeout: 240_000 } });
