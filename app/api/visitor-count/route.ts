import { NextRequest, NextResponse } from "next/server";
import {
  ensureDatabase,
  hashNetworkIdentifier,
} from "@/app/lib/database";
import { remoteIdentifier } from "@/app/lib/request-identity";

export const dynamic = "force-dynamic";

function response(total: number, status = 200) {
  return NextResponse.json(
    { total },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET() {
  try {
    const db = await ensureDatabase();
    const result = await db.execute(
      "SELECT total FROM visitor_totals WHERE id = 'site' LIMIT 1",
    );
    return response(Number(result.rows[0]?.total ?? 0));
  } catch {
    return response(0, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = await ensureDatabase();
    const now = new Date();
    const nowIso = now.toISOString();
    const visitDate = nowIso.slice(0, 10);
    const identifierHash = hashNetworkIdentifier(
      "visitor-day",
      `${visitDate}:${remoteIdentifier(request)}`,
    );

    await db.batch(
      [
        {
          sql: `INSERT OR IGNORE INTO visitor_totals (id, total, updated_at)
                VALUES ('site', 0, ?)`,
          args: [nowIso],
        },
        {
          sql: `INSERT OR IGNORE INTO visitor_daily_identifiers
                (identifier_hash, visit_date, created_at)
                VALUES (?, ?, ?)`,
          args: [identifierHash, visitDate, nowIso],
        },
        {
          sql: `UPDATE visitor_totals
                SET total = total + changes(), updated_at = ?
                WHERE id = 'site'`,
          args: [nowIso],
        },
        {
          sql: `DELETE FROM visitor_daily_identifiers
                WHERE visit_date < date('now', '-32 days')`,
          args: [],
        },
      ],
      "write",
    );

    const result = await db.execute(
      "SELECT total FROM visitor_totals WHERE id = 'site' LIMIT 1",
    );
    return response(Number(result.rows[0]?.total ?? 0));
  } catch {
    return response(0, 500);
  }
}
