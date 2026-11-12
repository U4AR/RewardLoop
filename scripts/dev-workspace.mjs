import { spawn } from "node:child_process";
import path from "node:path";

const port = process.env.WORKSPACE_PORT || "3001";
if (!/^\d{4,5}$/.test(port)) throw new Error("WORKSPACE_PORT must be a valid port");
const origin = `http://localhost:${port}`;
const child = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "dev", "--port", port], {
  stdio: "inherit", windowsHide: true,
  env: { ...process.env, APP_ORIGIN: origin, BETTER_AUTH_URL: origin, NEXT_DIST_DIR: ".next-workspace" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { child.kill(signal); });
child.on("exit", code => { process.exitCode = code ?? 1; });
