import { ensureDatabase } from "../app/lib/database";
import { deleteObject } from "../app/lib/storage";

/**
 * Retention sweep. Declined and withdrawn contributions carry a
 * `retention_eligible_at` date (180 days out, set when the status changes).
 * Nothing acted on those dates until this script, so rejected uploads stayed
 * in object storage forever — material an anonymous contributor asked us to
 * remove, or that a moderator declined precisely because it should not be
 * kept. Expired rate-limit rows go too; see the note further down.
 *
 * Removing the stored objects is the point; the row stays so the recovery code
 * still reports the outcome and the audit trail keeps its subject. A row whose
 * files are gone already serves 404 on the file route, so this changes nothing
 * a visitor can see.
 *
 * Run on a schedule against production:
 *   LIBSQL_URL=... LIBSQL_AUTH_TOKEN=... ART_S3_...=... npm run purge:expired
 * Pass --dry-run to list what would go without touching anything.
 */

export async function purgeExpired({ dryRun = false, now = new Date() } = {}) {
  const db = await ensureDatabase();
  const cutoff = now.toISOString();

  const expired = await db.execute({
    sql: `SELECT id, title, status, storage_key, social_storage_key
          FROM contributions
          WHERE retention_eligible_at IS NOT NULL
            AND retention_eligible_at <= ?
            AND (storage_key IS NOT NULL OR social_storage_key IS NOT NULL)`,
    args: [cutoff],
  });

  let files = 0;
  for (const row of expired.rows) {
    for (const key of [row.storage_key, row.social_storage_key]) {
      if (typeof key !== "string" || !key) continue;
      if (!dryRun) await deleteObject(key);
      files += 1;
    }
    if (!dryRun) {
      await db.execute({
        sql: `UPDATE contributions
              SET storage_key = NULL, social_storage_key = NULL, updated_at = ?
              WHERE id = ?`,
        args: [cutoff, row.id],
      });
    }
    console.log(`${dryRun ? "would purge" : "purged"} files for ${row.status}: ${row.title}`);
  }

  // Rate-limit rows are keyed on an HMAC of the caller's IP and stamped with
  // the moment they acted. Left to accumulate they outlive every retention
  // promise the site makes, and their timestamps line up with contribution
  // timestamps precisely enough to link a submission to an IP if the database
  // ever leaks. Nothing needs them once the window has closed.
  const staleLimits = await db.execute({
    sql: "SELECT count(*) AS total FROM rate_limits WHERE expires_at <= ?",
    args: [cutoff],
  });
  const limits = Number(staleLimits.rows[0]?.total ?? 0);
  if (limits > 0) {
    if (!dryRun) {
      await db.execute({
        sql: "DELETE FROM rate_limits WHERE expires_at <= ?",
        args: [cutoff],
      });
    }
    console.log(`${dryRun ? "would clear" : "cleared"} ${limits} expired rate-limit row(s)`);
  }

  return { contributions: expired.rows.length, files, rateLimits: limits };
}

const invokedDirectly = process.argv[1]?.endsWith("purge-expired.ts");
if (invokedDirectly) {
  const dryRun = process.argv.includes("--dry-run");
  const result = await purgeExpired({ dryRun });
  console.log(
    `${dryRun ? "Dry run: " : ""}${result.contributions} contribution(s), ` +
      `${result.files} file(s), ${result.rateLimits} rate-limit row(s).`,
  );
}
