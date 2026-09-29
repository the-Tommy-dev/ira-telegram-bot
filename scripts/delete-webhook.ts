import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const token = process.env.BOT_TOKEN;
  if (!token) throw new Error("BOT_TOKEN is required");
  const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, { method: "POST" });
  const result = await response.json() as { ok: boolean; description?: string };
  if (!result.ok) throw new Error(result.description ?? "Telegram rejected request");
  process.stdout.write("Webhook removed successfully.\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
