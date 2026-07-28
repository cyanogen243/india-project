import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ensureDatabase } from "../app/lib/database";
import { contentFingerprint, processImage } from "../app/lib/contributions";
import { putObject } from "../app/lib/storage";

/**
 * Seeds the contribution wall from content/seed-art. Idempotent: fixed ids and
 * INSERT OR IGNORE mean running it twice changes nothing, and a retired seed
 * is remembered so it never returns (see the tombstone check below).
 *
 * Run locally for development (npm run db:setup calls this), and once against
 * the production database before launch:
 *   LIBSQL_URL=libsql://... LIBSQL_AUTH_TOKEN=... ART_S3_...=... npm run seed:art
 *
 * The geometric posters are placeholders admins remove by hand as real
 * posters arrive. Everything else is permanent collection: public-domain
 * photographs and writing, with sources noted per item.
 */

type SeedItem = {
  id: string;
  kind: "poster" | "image" | "poem" | "essay";
  title: string;
  subtitle?: string;
  credit: string;
  language: "en" | "hi";
  file?: string;
  textFile?: string;
  sortAt: string;
};

// The wall sorts by created_at DESC, so these fixed timestamps encode the
// curated opening arrangement from the approved mockup: slot 1 renders first,
// kinds deliberately interleaved so posters and writing mix instead of
// clustering. Real contributions carry real timestamps and stack above the
// opening collection. db:setup refreshes the slot of an already-seeded row.
function wallSlot(position: number) {
  return new Date(Date.UTC(2026, 0, 26, 9, 0) - position * 60_000).toISOString();
}

const SEEDS: SeedItem[] = [
  // Geometric placeholder posters — admins remove these by hand as real ones arrive.
  { id: "5eed0001-0000-4000-8000-000000000001", kind: "poster", title: "Sunrise", credit: "The India Project", language: "en", file: "poster-sunrise.png", sortAt: wallSlot(1) },
  { id: "5eed0001-0000-4000-8000-000000000002", kind: "poster", title: "Stripes", credit: "The India Project", language: "en", file: "poster-stripes.png", sortAt: wallSlot(9) },
  { id: "5eed0001-0000-4000-8000-000000000003", kind: "poster", title: "Peaks", credit: "The India Project", language: "en", file: "poster-peaks.png", sortAt: wallSlot(3) },
  { id: "5eed0001-0000-4000-8000-000000000004", kind: "poster", title: "Rays", credit: "The India Project", language: "en", file: "poster-rays.png", sortAt: wallSlot(11) },

  // Images — permanent. Salt March photographs verified public domain in
  // India and the US (PD-India + PD-India-URAA on their Commons file pages).
  { id: "5eed0002-0000-4000-8000-000000000001", kind: "image", title: "Breaking the Salt Law, 1930", subtitle: "Dandi, 5 April 1930", credit: "Public domain", language: "en", file: "image-breaking-the-salt-law.jpg", sortAt: wallSlot(10) },
  { id: "5eed0002-0000-4000-8000-000000000002", kind: "image", title: "The March to Dandi, 1930", credit: "Public domain", language: "en", file: "image-march-to-dandi.jpg", sortAt: wallSlot(5) },
  { id: "5eed0002-0000-4000-8000-000000000003", kind: "image", title: "Evening River", credit: "The India Project", language: "en", file: "image-evening-river.png", sortAt: wallSlot(12) },

  // Poems — permanent, public domain.
  { id: "5eed0003-0000-4000-8000-000000000001", kind: "poem", title: "दोहा", credit: "कबीर (Kabir)", language: "hi", textFile: "poem-kabir-doha.txt", sortAt: wallSlot(2) },
  { id: "5eed0003-0000-4000-8000-000000000002", kind: "poem", title: "दोहा", credit: "रहीम (Rahim)", language: "hi", textFile: "poem-rahim-doha.txt", sortAt: wallSlot(6) },
  { id: "5eed0003-0000-4000-8000-000000000003", kind: "poem", title: "Where the Mind Is Without Fear", subtitle: "Gitanjali 35", credit: "Rabindranath Tagore", language: "en", textFile: "poem-where-the-mind.txt", sortAt: wallSlot(8) },
  { id: "5eed0003-0000-4000-8000-000000000004", kind: "poem", title: "फ़रमान-ए-ख़ुदा", subtitle: "फ़रिशतों से", credit: "मुहम्मद इक़बाल (Muhammad Iqbal)", language: "hi", textFile: "poem-farman-e-khuda.txt", sortAt: wallSlot(7) },

  // Essay — permanent. Verbatim from marxists.org/archive/bhagat-singh/1931/02/02.htm
  { id: "5eed0004-0000-4000-8000-000000000001", kind: "essay", title: "To Young Political Workers", subtitle: "A letter, February 1931", credit: "Bhagat Singh", language: "en", textFile: "essay-to-young-political-workers.txt", sortAt: wallSlot(4) },
];

// Seeds carry no usable recovery code: the hash is derived from the fixed id
// with a prefix no 8-character code can produce, so no lookup can match it.
function seedCodeHash(id: string) {
  return createHash("sha256").update(`seed:${id}`).digest("hex");
}

export async function seedContributions() {
  const db = await ensureDatabase();
  const now = new Date().toISOString();

  for (const seed of SEEDS) {
    // Tombstone check: a seed an admin has deleted must not be recreated by
    // the next run. Deletion writes an audit event; its presence is the
    // permanent record that this seed was removed on purpose.
    const removed = await db.execute({
      sql: `SELECT 1 FROM audit_events
            WHERE action IN ('deleted', 'seed_retired') AND entity_id = ? LIMIT 1`,
      args: [seed.id],
    });
    if (removed.rows.length > 0) continue;

    // An already-present seed only has its wall slot refreshed: databases
    // seeded before the curated order existed carry insertion-time stamps.
    const existing = await db.execute({
      sql: "SELECT 1 FROM contributions WHERE id = ?",
      args: [seed.id],
    });
    if (existing.rows.length > 0) {
      await db.execute({
        sql: "UPDATE contributions SET created_at = ? WHERE id = ? AND seeded = 1 AND created_at <> ?",
        args: [seed.sortAt, seed.id, seed.sortAt],
      });
      continue;
    }

    let storageKey: string | null = null;
    let socialKey: string | null = null;
    let mimeType: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    let byteSize: number | null = null;
    let fingerprint: string | null = null;
    let body = "";

    if (seed.file) {
      const bytes = new Uint8Array(await readFile(`content/seed-art/${seed.file}`));
      // Same pipeline as real uploads: re-encode, strip metadata, size variants.
      const processed = await processImage(bytes);
      await putObject(processed.printKey, processed.printBytes, processed.mimeType);
      await putObject(processed.socialKey, processed.socialBytes, "image/jpeg");
      storageKey = processed.printKey;
      socialKey = processed.socialKey;
      mimeType = processed.mimeType;
      width = processed.width;
      height = processed.height;
      byteSize = processed.printBytes.byteLength;
      fingerprint = contentFingerprint(processed.printBytes);
    }
    if (seed.textFile) {
      body = (await readFile(`content/seed-art/${seed.textFile}`, "utf8")).trim();
    }

    await db.execute({
      sql: `INSERT OR IGNORE INTO contributions
        (id, kind, title, subtitle, credit, credit_account, body, language,
         storage_key, social_storage_key, mime_type, width, height, byte_size,
         status, internal_notes, content_fingerprint, seeded, recovery_code_hash,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 'approved',
                'Seeded from content/seed-art', ?, 1, ?, ?, ?)`,
      args: [
        seed.id, seed.kind, seed.title, seed.subtitle ?? "", seed.credit,
        body, seed.language, storageKey, socialKey, mimeType, width, height,
        byteSize, fingerprint, seedCodeHash(seed.id), seed.sortAt, now,
      ],
    });
    console.log(`seeded ${seed.kind}: ${seed.title}`);
  }
}

const invokedDirectly = process.argv[1]?.endsWith("seed-contributions.ts");
if (invokedDirectly) {
  seedContributions().then(() => console.log("Contribution seeds ensured."));
}
