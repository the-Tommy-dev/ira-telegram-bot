import postgres from "postgres";

const products = [
  ["marshrut", "Маршрут построен", true, 10],
  ["vkus_zhizni", "Вкус жизни", true, 20],
  ["ya_vse_mogu", "Я всё могу", true, 30],
  ["karty_iry", "Карты Иры", false, 40],
  ["alhimiya_realnosti", "Алхимия Реальности", false, 50],
  ["zazerkalie", "Зазеркалье", false, 60],
  ["free_body_meditation", "Бесплатная медитация тела", false, 70],
  ["personal_consultation", "Личная консультация", false, 80],
  ["quick_diagnostics", "Быстрая диагностика", false, 90],
] as const;

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    for (const [id, title, trialEnabled, order] of products) {
      await sql`
        INSERT INTO products (product_id, title, trial_enabled, sort_order)
        VALUES (${id}, ${title}, ${trialEnabled}, ${order})
        ON CONFLICT (product_id) DO UPDATE SET
          title = EXCLUDED.title,
          trial_enabled = EXCLUDED.trial_enabled,
          sort_order = EXCLUDED.sort_order,
          updated_at = now()
      `;
    }
    await sql`
      INSERT INTO app_config (key, value) VALUES
        ('bot_timezone', '"Europe/Helsinki"'::jsonb),
        ('send_window', '{"start":"09:00","end":"20:00"}'::jsonb),
        ('chain_version', '1'::jsonb)
      ON CONFLICT (key) DO NOTHING
    `;
    process.stdout.write(`Seeded ${products.length} products\n`);
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
