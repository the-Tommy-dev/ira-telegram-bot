import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleTelegramUpdate } from "@/lib/telegram/handler";
import type { TgUpdate } from "@/lib/telegram/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const expected = env().TELEGRAM_WEBHOOK_SECRET;
  const received = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || received !== expected) return NextResponse.json({ ok: false }, { status: 401 });
  const update = (await request.json()) as TgUpdate;
  await handleTelegramUpdate(update);
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: false, message: "POST only" }, { status: 405 });
}
