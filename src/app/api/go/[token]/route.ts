import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const runtime = "nodejs";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!uuidPattern.test(token)) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const sql = db();
  const [link] = await sql<Array<{
    telegram_user_id: string;
    product_id: string | null;
    trial_id: string | null;
    purpose: string;
    destination_url: string;
  }>>`
    UPDATE outbound_links SET clicked_at = now(), click_count = click_count + 1
    WHERE token = ${token}
    RETURNING telegram_user_id::text, product_id, trial_id::text, purpose, destination_url
  `;
  if (!link) return NextResponse.json({ error: "Link not found" }, { status: 404 });

  const eventName = link.purpose === "purchase" ? "purchase_clicked" : "outbound_link_clicked";
  await sql.begin(async (tx) => {
    await tx`
      INSERT INTO events (telegram_user_id, event_name, product_id, trial_id, metadata)
      VALUES (${link.telegram_user_id}, ${eventName}, ${link.product_id}, ${link.trial_id}, ${tx.json({ purpose: link.purpose })})
    `;
    if (link.purpose === "purchase") {
      await tx`
        UPDATE users SET purchase_click_count = purchase_click_count + 1,
          purchase_status = 'clicked', lead_temperature = 'hot', updated_at = now()
        WHERE telegram_user_id = ${link.telegram_user_id}
      `;
      if (link.trial_id) {
        await tx`
          UPDATE trials SET purchase_clicked_at = now(), purchase_status = 'clicked', updated_at = now()
          WHERE trial_id = ${link.trial_id}
        `;
      }
    }
  });

  const destination = new URL(link.destination_url);
  if (!['http:', 'https:'].includes(destination.protocol)) {
    return NextResponse.json({ error: "Unsupported destination" }, { status: 400 });
  }
  if (!destination.searchParams.has("utm_source")) destination.searchParams.set("utm_source", "telegram_bot");
  if (!destination.searchParams.has("utm_medium")) destination.searchParams.set("utm_medium", link.trial_id ? "trial" : "bot");
  if (link.product_id && !destination.searchParams.has("utm_campaign")) destination.searchParams.set("utm_campaign", link.product_id);
  if (!destination.searchParams.has("utm_content")) destination.searchParams.set("utm_content", link.purpose);
  destination.searchParams.set("bot_ref", token);
  return NextResponse.redirect(destination, 302);
}
