import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// APP_VERSION arrives from the deployment environment, not the build: release
// tags are aliased onto images after they are built, so the running tag is
// only knowable at deploy time.
export function GET() {
  return NextResponse.json({ version: process.env.APP_VERSION ?? "dev" });
}
