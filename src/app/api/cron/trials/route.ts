import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deliverTrialTouch } from "@/lib/telegram/handler";
import { withinSendWindow } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorized(request: Request) {
  const secret = env().CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const now = new Date();
  if (!withinSendWindow(now, env().BOT_TIMEZONE, env().SEND_WINDOW_START, env().SEND_WINDOW_END)) {
    return NextResponse.json({ ok: true, skipped: "outside_send_window" });
  }
  const due = await db()<Array<{ trial_id: string; touch_number: number }>>`
    SELECT tt.trial_id::text, tt.touch_number
    FROM trial_touches tt
    JOIN trials t ON t.trial_id = tt.trial_id
    WHERE tt.status IN ('pending','failed')
      AND tt.attempt_count < 3
      AND tt.due_at <= now()
      AND t.status IN ('active','scheduled')
    ORDER BY tt.due_at
    LIMIT 50
  `;
  let delivered = 0;
  for (const touch of due) {
    if (await deliverTrialTouch(touch.trial_id, touch.touch_number)) delivered += 1;
  }
  await db()`DELETE FROM processed_updates WHERE processed_at < now() - interval '14 days'`;
  return NextResponse.json({ ok: true, found: due.length, delivered });
}
