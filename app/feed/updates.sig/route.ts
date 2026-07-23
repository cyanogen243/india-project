import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getActiveFeedRelease } from "@/app/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const release = await getActiveFeedRelease();
    if (release) {
      return new NextResponse(`${release.signature}\n`, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store, max-age=0",
        },
      });
    }
  } catch {}
  try {
    return new NextResponse(await readFile("content/feed/updates.sig", "utf8"), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch {
    return new NextResponse("Feed signature unavailable\n", { status: 503 });
  }
}
