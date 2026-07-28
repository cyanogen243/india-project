import { NextRequest, NextResponse } from "next/server";
import { getAdminSession } from "@/app/lib/auth";
import { ensureDatabase } from "@/app/lib/database";
import { contentTypeForKey, getObject } from "@/app/lib/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Files are proxied through the application rather than served from storage
 * URLs directly. That keeps `img-src 'self'` intact, stops a third-party CDN
 * accumulating a log of who downloaded which poster, and makes removal
 * immediate: a withdrawn or deleted row stops resolving here, whereas a public
 * object URL would stay live for anyone holding the link.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const variant = url.searchParams.get("variant") === "social" ? "social" : "print";
  const asDownload = url.searchParams.get("download") === "1";

  const db = await ensureDatabase();
  const result = await db.execute({
    sql: `SELECT title, status, storage_key, social_storage_key
          FROM contributions WHERE id = ?`,
    args: [id],
  });
  const row = result.rows[0];
  if (!row) return new NextResponse("Not found", { status: 404 });

  // Approved work is public. Anything still in the queue is visible only to a
  // signed-in moderator, so review never leaks pending submissions.
  if (row.status !== "approved") {
    const user = await getAdminSession(request);
    if (!user) return new NextResponse("Not found", { status: 404 });
  }

  const key = variant === "social" ? row.social_storage_key : row.storage_key;
  if (typeof key !== "string" || !key) {
    return new NextResponse("Not found", { status: 404 });
  }

  const object = await getObject(key);
  if (!object) return new NextResponse("Not found", { status: 404 });

  const safeTitle =
    String(row.title).replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 60) || "poster";
  const extension = key.endsWith(".png") ? "png" : "jpg";

  return new NextResponse(Buffer.from(object.bytes), {
    headers: {
      // Set from the key we generated, never echoed from the upload. The file
      // was re-encoded by us, so this type is known rather than claimed.
      "Content-Type": contentTypeForKey(key),
      "Content-Disposition": `${asDownload ? "attachment" : "inline"}; filename="${safeTitle}.${extension}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      // Deliberately revalidated rather than `immutable`: withdrawal and
      // moderation have to take effect for people who already loaded the file.
      // An immutable year-long entry would keep serving a poster the
      // contributor took down — or one declined for identifying someone —
      // from browser and shared caches at this same URL, with no way to
      // invalidate it. A short window with revalidation keeps most of the
      // bandwidth win and lets removal actually remove.
      "Cache-Control":
        row.status === "approved"
          ? "public, max-age=300, must-revalidate"
          : "private, no-store",
    },
  });
}
