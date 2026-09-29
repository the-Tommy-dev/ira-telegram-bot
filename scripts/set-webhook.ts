import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const token = process.env.BOT_TOKEN;
  const baseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !baseUrl || !secret) throw new Error("BOT_TOKEN, PUBLIC_BASE_URL and TELEGRAM_WEBHOOK_SECRET are required");
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: `${baseUrl}/api/telegram/webhook`,
      secret_token: secret,
      allowed_updates: ["message", "callback_query"],
      drop_pending_updates: false,
    }),
  });
  const result = await response.json() as { ok: boolean; description?: string };
  if (!result.ok) throw new Error(result.description ?? "Telegram rejected webhook");
  process.stdout.write("Webhook configured successfully.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
