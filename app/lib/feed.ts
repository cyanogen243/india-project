import "server-only";

import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { ensureDatabase } from "@/app/lib/database";
import type { Update } from "@/app/lib/content";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

async function getPrivateKey() {
  if (process.env.FEED_SIGNING_PRIVATE_KEY) {
    return process.env.FEED_SIGNING_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  try {
    return await readFile(".private/feed-private.pem", "utf8");
  } catch {
    throw new Error(
      "Publishing updates requires FEED_SIGNING_PRIVATE_KEY or .private/feed-private.pem",
    );
  }
}

export async function createSignedFeedRelease(
  updates: Update[],
  actorUserId: string,
) {
  const db = await ensureDatabase();
  const release = await buildSignedFeedRelease(updates);
  await db.batch(
    [
      { sql: "UPDATE feed_releases SET active = 0 WHERE active = 1", args: [] },
      {
        sql: `INSERT INTO feed_releases
          (id, payload, signature, public_key, generated_at, created_by, active)
          VALUES (?, ?, ?, ?, ?, ?, 1)`,
        args: [
          release.id,
          release.payload,
          release.signature,
          release.publicKey,
          release.generatedAt,
          actorUserId,
        ],
      },
    ],
    "write",
  );
  return release;
}

export async function buildSignedFeedRelease(updates: Update[]) {
  const generatedAt = new Date().toISOString();
  const payload = stable({
    generatedAt,
    languages: ["en", "hi"],
    updates: updates.map((item) => ({
      city: item.city,
      eventTime: item.eventTime,
      ...(item.expiresAt ? { expiresAt: item.expiresAt } : {}),
      id: item.id,
      language: item.language,
      publishedAt: item.publishedAt,
      sources: item.sources,
      status: item.status,
      summary: item.summary,
      title: item.title,
      zone: item.zone,
    })),
  });
  const privateKey = createPrivateKey(await getPrivateKey());
  const signature = sign(null, Buffer.from(payload), privateKey).toString("base64");
  const publicKey = createPublicKey(privateKey)
    .export({ format: "pem", type: "spki" })
    .toString();
  const id = randomUUID();
  return { id, payload, signature, publicKey, generatedAt };
}

export async function getActiveFeedRelease() {
  const db = await ensureDatabase();
  const result = await db.execute(
    `SELECT payload, signature, public_key, generated_at
     FROM feed_releases WHERE active = 1
     ORDER BY generated_at DESC LIMIT 1`,
  );
  const row = result.rows[0];
  return row
    ? {
        payload: String(row.payload),
        signature: String(row.signature),
        publicKey: String(row.public_key),
        generatedAt: String(row.generated_at),
      }
    : null;
}
