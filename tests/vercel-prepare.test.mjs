import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createClient } from "@libsql/client";
import { startMockS3 } from "./helpers/mock-s3.mjs";

function runPreparation(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/vercel-prepare.mjs"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.once("error", reject);
    child.once("exit", (status) => resolve({ status, output }));
  });
}

test("the Vercel production gate checks storage, migrates, and seeds once", async () => {
  const s3 = await startMockS3();
  const directory = await mkdtemp(path.join(tmpdir(), "tip-vercel-prepare-"));
  const databasePath = path.join(directory, "app.db").replaceAll("\\", "/");
  let db;

  try {
    const env = {
      ...process.env,
      VERCEL: "1",
      VERCEL_ENV: "production",
      LIBSQL_URL: `file:${databasePath}`,
      SESSION_SECRET: "test-session-secret-not-for-production",
      RATE_LIMIT_SECRET: "test-rate-limit-secret-not-for-production",
      ART_S3_ENDPOINT: s3.endpoint,
      ART_S3_BUCKET: s3.bucket,
      ART_S3_ACCESS_KEY_ID: "test-access-key",
      ART_S3_SECRET_ACCESS_KEY: "test-secret-key",
      ART_S3_REGION: "us-east-1",
    };

    const first = await runPreparation(env);
    assert.equal(first.status, 0, first.output);
    assert.match(first.output, /Storage is usable/);
    assert.match(first.output, /Production storage, schema, and contribution seeds are ready/);

    db = createClient({ url: `file:${databasePath}` });
    const seeded = await db.execute(
      "SELECT count(*) AS total FROM contributions WHERE seeded = 1",
    );
    assert.equal(Number(seeded.rows[0].total), 12, "the opening collection is present");
    assert.equal(s3.keys().length, 14, "seven image seeds each have print and social files");

    const second = await runPreparation(env);
    assert.equal(second.status, 0, second.output);
    const stillSeeded = await db.execute(
      "SELECT count(*) AS total FROM contributions WHERE seeded = 1",
    );
    assert.equal(Number(stillSeeded.rows[0].total), 12, "a second release does not duplicate rows");
    assert.equal(s3.keys().length, 14, "or duplicate stored files");
  } finally {
    db?.close();
    await s3.close();
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("preview builds cannot run production preparation", async () => {
  const result = await runPreparation({
    ...process.env,
    VERCEL: "1",
    VERCEL_ENV: "preview",
  });
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Skipped production storage and database preparation/);
});
