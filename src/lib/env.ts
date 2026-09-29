import { z } from "zod";

const optionalString = z.string().trim().min(1).optional();

const schema = z.object({
  BOT_TOKEN: optionalString,
  TELEGRAM_WEBHOOK_SECRET: optionalString,
  PUBLIC_BASE_URL: optionalString,
  DATABASE_URL: optionalString,
  CRON_SECRET: optionalString,
  BOT_TIMEZONE: z.string().default("Europe/Helsinki"),
  SEND_WINDOW_START: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  SEND_WINDOW_END: z.string().regex(/^\d{2}:\d{2}$/).default("20:00"),
  ADMIN_CHAT_ID: optionalString,
  ADMIN_USER_IDS: optionalString,
  GOOGLE_SPREADSHEET_ID: optionalString,
  GOOGLE_SERVICE_ACCOUNT_EMAIL: optionalString,
  GOOGLE_PRIVATE_KEY: optionalString,
  GOOGLE_SHEET_URL: optionalString,
  INTRO_PHOTO_FILE_ID: optionalString,
  INTRO_VIDEO_NOTE_FILE_ID: optionalString,
});

export type AppEnv = z.infer<typeof schema>;

let cached: AppEnv | undefined;

export function env(): AppEnv {
  cached ??= schema.parse(process.env);
  return cached;
}

export function requireEnv<K extends keyof AppEnv>(key: K): NonNullable<AppEnv[K]> {
  const value = env()[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value as NonNullable<AppEnv[K]>;
}

export function isAdmin(userId: string | number): boolean {
  return (env().ADMIN_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(String(userId));
}
