# Security notes

- Never commit Telegram, database, Vercel, or Google service-account credentials.
- Rotate any Telegram token that has appeared in chat, logs, screenshots, or source control.
- Production webhook requests require Telegram's secret header.
- Cron endpoints require `CRON_SECRET` as a bearer token.
- Admin replies require an explicit Telegram user-ID allowlist.
- Tracked external links contain only a random UUID; Telegram IDs and usernames are not exposed to Tilda.
- Keep the GitHub repository private and protect `main` with pull-request review and required CI checks.
- Restrict Google Sheet access to named collaborators and protect technical ranges.
- Establish a documented retention period and privacy notice before collecting real user data.
