import { spawnSync } from "node:child_process";

/**
 * Gates a Vercel production release on its durable dependencies.
 *
 * Preview builds deliberately skip this step because this project's Preview
 * variables currently point at the production Turso database. The production
 * build runs before Vercel assigns the live domains, so a failed bucket check,
 * migration, or seed stops the deployment while the previous release remains
 * live.
 */
if (process.env.VERCEL !== "1" || process.env.VERCEL_ENV !== "production") {
  console.log("Skipped production storage and database preparation.");
  process.exit(0);
}

function runTypeScript(script) {
  const result = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", script],
    { env: process.env, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${script} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

runTypeScript("scripts/check-storage.ts");
runTypeScript("scripts/db-setup.ts");
console.log("Production storage, schema, and contribution seeds are ready.");
