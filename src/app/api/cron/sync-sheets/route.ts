import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { syncGoogleSheets } from "@/lib/sheets";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = env().CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await syncGoogleSheets()) });
}
