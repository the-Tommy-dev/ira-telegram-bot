# Telegram-бот Иры

Production-oriented Telegram bot based on the flows in `ira_telegram_bot_complete_spec.md`.

## What is implemented

- `/start` and deep-link attribution (`src_*`, `campaign_*`, `product_*`)
- three main navigation branches and stable callback IDs
- product/service cards with hidden unset fields
- schedule and current-offers blocks
- one active free trial per Telegram user
- individual day 0/3/6/7 trial touches with retry and duplicate protection
- fixed `Europe/Helsinki` timezone and configurable 09:00–20:00 send window
- trial feedback, completion, cancellation, and continuation path
- personal question collection and replies through a private admin chat
- text, voice, video, video note, audio, document, and photo admin replies
- PostgreSQL source of truth and append-only event history
- seven-tab Google Sheets mirror: `Users`, `Events`, `Trials`, `Questions`, `Follow_up`, `Dashboard`, `Config`
- privacy notice and user-initiated deletion
- tracked Tilda redirects with UTM fields and a non-personal `bot_ref`
- Vercel cron endpoints and GitHub CI

Unset media, descriptions, prices, events, offers, and sales links remain hidden until configured.

## Architecture

```text
Telegram webhook
      │
      ▼
Vercel /api/telegram/webhook ─── PostgreSQL
      │                              │
      ├── Telegram Bot API           ├── trial scheduler
      ├── admin question chat        ├── event history
      └── tracked Tilda links        └── Google Sheets mirror
```

Google Sheets is a reporting/operations mirror, not the transactional database. A temporary Sheets failure therefore does not interrupt bot conversations.

## Local setup

Requirements: Node.js 20+, a PostgreSQL database, and a Telegram bot.

1. Install packages:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env.local` and populate it. Never commit `.env.local`.
3. Apply the database schema and seed stable products:

   ```powershell
   npm run db:migrate
   npm run db:seed
   ```

4. Start locally:

   ```powershell
   npm run dev
   ```

Telegram cannot call `localhost`; use a separate HTTPS tunnel and test bot if testing live webhook traffic locally.

## Required environment variables

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Telegram bot token; secret |
| `TELEGRAM_WEBHOOK_SECRET` | Random webhook verification value |
| `PUBLIC_BASE_URL` | Production HTTPS origin, without trailing slash |
| `DATABASE_URL` | PostgreSQL connection string; secret |
| `CRON_SECRET` | Random bearer secret used by Vercel Cron |
| `ADMIN_CHAT_ID` | Private chat/group receiving user questions |
| `ADMIN_USER_IDS` | Comma-separated Telegram user IDs allowed to answer |

Optional Google variables are documented in `.env.example`. For `GOOGLE_PRIVATE_KEY`, keep the PEM as one environment value; escaped `\n` line breaks are supported.

Generate independent secrets, for example:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Google Sheets

1. Create one spreadsheet.
2. Create a Google Cloud service account and enable the Google Sheets API.
3. Share the spreadsheet with the service account email as Editor.
4. Add `GOOGLE_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, and `GOOGLE_PRIVATE_KEY` to Vercel.
5. Run `npm run sheets:init`, or let the scheduled sync create/populate all seven tabs.

The current `Config` tab is an exported product configuration view. Code/database remains authoritative until a reviewed two-way editing workflow is intentionally enabled.

## Admin question workflow

1. Add the bot to a private group, or open a private chat with it.
2. Put its numeric chat ID in `ADMIN_CHAT_ID`.
3. Put allowed responder user IDs in `ADMIN_USER_IDS`.
4. A responder presses **Ответить через бота**, sends one supported message, previews the confirmation prompt, and presses **Отправить**.

Merely being present in the group does not grant reply authorization.

## Vercel and GitHub deployment

1. Create a private GitHub repository and push this project.
2. Import it into a Vercel Pro team. Connect `main` as the production branch.
3. Add a managed PostgreSQL integration and all environment variables to Production.
4. Deploy once.
5. Pull production variables locally (`vercel env pull .env.local --environment=production`) or set them securely in your shell, then run migrations and seed.
6. Set `PUBLIC_BASE_URL` to the final production domain and redeploy.
7. Run `npm run telegram:set-webhook` once.
8. Verify `/api/health`, then send `/start` to the bot.

Vercel Preview deployments should use a separate test bot and database. Do not point the production Telegram webhook at a preview URL.

## Updating content

Product rows are created by `scripts/seed.ts`. Descriptions, media file IDs, prices, URLs, offers, and schedule entries can be updated in PostgreSQL. Fields left `NULL` are not shown by the bot.

For Telegram-hosted media, send the media to the bot once, inspect its Telegram `file_id`, and store that value. This avoids repeatedly uploading large files.

## Commands

- `/start` — start/main menu
- `/menu` — main menu
- `/stop` — stop an active trial
- `/privacy` — short data-use notice
- `/delete_me` — permanently delete the user’s stored data

## Verification

```powershell
npm test
npm run lint
npm run build
```

The deployment is not production-ready until the bot token has been rotated, production secrets are configured, database migrations have run, the admin allowlist is set, and the missing content/media/Tilda links are supplied.
