import { existsSync } from "node:fs";
import EmbeddedPostgres from "embedded-postgres";

const databaseDir = ".local-postgres";
const cluster = new EmbeddedPostgres({
  databaseDir,
  user: "rewardloop",
  password: "local_demo_only",
  port: 5432,
  persistent: true,
  onLog: (message) => process.stderr.write(message),
  onError: (error) => console.error(String(error)),
});

if (!existsSync(`${databaseDir}/PG_VERSION`)) await cluster.initialise();
await cluster.start();
try { await cluster.createDatabase("rewardloop"); } catch (error) {
  if (!String(error).includes("already exists")) throw error;
}
console.log("Local PostgreSQL is ready on 127.0.0.1:5432");

const close = async () => { await cluster.stop(); process.exit(0); };
process.on("SIGINT", close);
process.on("SIGTERM", close);
await new Promise(() => {});
