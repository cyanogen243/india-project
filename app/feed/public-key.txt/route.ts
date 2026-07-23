import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getActiveFeedRelease } from "@/app/lib/feed";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const release = await getActiveFeedRelease();
    if (release) {
      return new NextResponse(release.publicKey, {
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }
  } catch {}
  try {
    return new NextResponse(await readFile("content/feed/public-key.txt", "utf8"), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return new NextResponse("Feed public key unavailable\n", { status: 503 });
  }
}
