import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";

/**
 * Starting a production server for a test suite to talk to.
 *
 * Three suites needed the same thing — find a free port, bootstrap an admin,
 * spawn `next start`, wait for it to answer — and each carried its own copy.
 * Three copies is three chances for them to drift apart on the details that
 * matter, like which environment variables are blanked so the suite cannot
 * silently reach a real bucket.
 */

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next.js production server did not start");
}

/**
 * Bootstraps the super admin, starts `next start` on a free port, and resolves
 * once it answers. Returns the child process and its base URL; the caller is
 * responsible for `stopTestServer` in its own `after` hook.
 */
export async function startTestServer(env) {
  const bootstrap = spawnSync(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "scripts/bootstrap-admin.ts"],
    { env, encoding: "utf8" },
  );
  assert.equal(bootstrap.status, 0, bootstrap.stderr || bootstrap.stdout);

  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)],
    { stdio: "ignore", env },
  );
  await waitForServer(baseUrl);
  return { server, baseUrl };
}

export async function stopTestServer(server) {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await exited;
}

/**
 * The storage variables blanked so a suite cannot reach a real bucket.
 *
 * Set to empty rather than deleted on purpose: Next loads `.env.local` itself,
 * and that file points at a real bucket. Deleting these let it back in, so a
 * suite that believed it was using the disk fallback was quietly writing to
 * someone's object storage.
 */
export const NO_BUCKET_ENV = {
  ART_S3_ENDPOINT: "",
  ART_S3_BUCKET: "",
  ART_S3_ACCESS_KEY_ID: "",
  ART_S3_SECRET_ACCESS_KEY: "",
  ART_S3_REGION: "",
};
