import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getActiveFeedRelease } from "@/app/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const release = await getActiveFeedRelease();
    if (release) {
      return new NextResponse(release.payload, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store, max-age=0",
        },
      });
    }
  } catch {}

  try {
    const fallback = await readFile("content/feed/updates.json", "utf8");
    return new NextResponse(fallback, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return NextResponse.json({ error: "Feed unavailable" }, { status: 503 });
  }
}
