import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Volunteer intake is currently closed." },
    { status: 410 },
  );
}
