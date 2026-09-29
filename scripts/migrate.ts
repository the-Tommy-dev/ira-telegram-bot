import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    const migrationsDir = path.join(process.cwd(), "migrations");
    const files = (await fs.readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
    await sql`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    for (const file of files) {
      const [existing] = await sql`SELECT name FROM schema_migrations WHERE name = ${file}`;
      if (existing) continue;
      const source = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(source);
        await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      });
      process.stdout.write(`Applied ${file}\n`);
    }
  } finally {
    await sql.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
