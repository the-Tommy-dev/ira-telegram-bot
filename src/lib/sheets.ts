import { auth, sheets } from "@googleapis/sheets";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

const tabNames = ["Users", "Events", "Trials", "Questions", "Follow_up", "Dashboard", "Config"] as const;

function configured() {
  const config = env();
  return Boolean(config.GOOGLE_SPREADSHEET_ID && config.GOOGLE_SERVICE_ACCOUNT_EMAIL && config.GOOGLE_PRIVATE_KEY);
}

function client() {
  const config = env();
  const jwt = new auth.JWT({
    email: config.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: config.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return sheets({ version: "v4", auth: jwt });
}

function cell(value: unknown): string | number | boolean {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  if (Array.isArray(value)) return value.join(", ");
  return value as string | number | boolean;
}

async function ensureTabs(api: ReturnType<typeof client>, spreadsheetId: string) {
  const current = await api.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
  const existing = new Set(current.data.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean));
  const requests = tabNames
    .filter((title) => !existing.has(title))
    .map((title) => ({ addSheet: { properties: { title, frozenRowCount: 1 } } }));
  if (requests.length) await api.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

async function replaceTab(
  api: ReturnType<typeof client>,
  spreadsheetId: string,
  title: string,
  values: Array<Array<string | number | boolean>>,
) {
  await api.spreadsheets.values.clear({ spreadsheetId, range: `'${title}'!A:AZ` });
  if (values.length) {
    await api.spreadsheets.values.update({
      spreadsheetId,
      range: `'${title}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}

export async function syncGoogleSheets() {
  if (!configured()) return { enabled: false, rows: 0 };
  const spreadsheetId = env().GOOGLE_SPREADSHEET_ID!;
  const api = client();
  const sql = db();
  await ensureTabs(api, spreadsheetId);

  const users = await sql<Array<Record<string, unknown>>>`
    SELECT telegram_user_id::text, first_name, last_name, username, phone, first_seen_at,
      last_activity_at, entry_source, entry_campaign, start_parameter_raw, first_flow,
      current_flow, current_stage, stage_number, last_event, last_product_id,
      interested_products, active_trial_id::text, trials_started_count, trials_completed_count,
      trial_products, purchase_click_count, purchase_status, lead_temperature,
      personal_follow_up, follow_up_reason, manager_status, manager_comment, next_contact_at, updated_at
    FROM users ORDER BY first_seen_at
  `;
  const events = await sql<Array<Record<string, unknown>>>`
    SELECT event_id::text, occurred_at, telegram_user_id::text, event_name, flow_id, stage_id,
      stage_number, product_id, trial_id::text, touch_number, content_type, button_id,
      source, campaign, metadata FROM events ORDER BY occurred_at DESC LIMIT 20000
  `;
  const trials = await sql<Array<Record<string, unknown>>>`
    SELECT trial_id::text, telegram_user_id::text, product_id, started_at, scheduled_end_at,
      completed_at, status, current_touch, feedback_status, feedback_answer, feedback_text,
      asked_ira, continuation_clicked, purchase_clicked_at, purchase_status, updated_at
    FROM trials ORDER BY started_at DESC
  `;
  const questions = await sql<Array<Record<string, unknown>>>`
    SELECT question_id::text, created_at, telegram_user_id::text, username, product_id,
      trial_id::text, touch_number, question_text, status, ira_telegram_message_id::text,
      assigned_to::text, answer_text, answered_at, updated_at
    FROM questions ORDER BY created_at DESC
  `;
  const followUp = await sql<Array<Record<string, unknown>>>`
    SELECT f.priority, concat_ws(' ', u.first_name, u.last_name) AS user_name, u.username,
      f.reason, f.product_id, f.recommended_action, f.initiative, u.last_activity_at,
      f.assigned_to, f.status, f.comment, f.updated_at
    FROM follow_up f JOIN users u USING (telegram_user_id)
    ORDER BY CASE f.priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, f.updated_at DESC
  `;
  const products = await sql<Array<Record<string, unknown>>>`
    SELECT product_id, title, short_description, format, duration, price, details_url,
      purchase_url, booking_url, trial_enabled, active, sort_order, updated_at
    FROM products ORDER BY sort_order
  `;
  const dashboard = await sql<Array<Record<string, unknown>>>`
    SELECT
      COUNT(*) FILTER (WHERE first_seen_at >= current_date) AS new_today,
      COUNT(*) FILTER (WHERE first_seen_at >= now() - interval '7 days') AS new_7_days,
      COUNT(*) FILTER (WHERE first_seen_at >= date_trunc('month', now())) AS new_this_month,
      COUNT(*) FILTER (WHERE trials_started_count > 0) AS trial_users,
      COUNT(*) FILTER (WHERE trials_completed_count > 0) AS completed_users,
      COUNT(*) FILTER (WHERE purchase_click_count > 0) AS purchase_click_users
    FROM users
  `;
  const questionMetrics = await sql<Array<Record<string, unknown>>>`
    SELECT COUNT(*) FILTER (WHERE status IN ('new','in_progress')) AS open_questions,
      COUNT(*) FILTER (WHERE status = 'answered') AS answered_questions FROM questions
  `;

  const rows = (items: Array<Record<string, unknown>>) => {
    if (!items.length) return [];
    const headers = Object.keys(items[0]);
    return [headers, ...items.map((item) => headers.map((header) => cell(item[header])))];
  };
  await replaceTab(api, spreadsheetId, "Users", rows(users));
  await replaceTab(api, spreadsheetId, "Events", rows(events));
  await replaceTab(api, spreadsheetId, "Trials", rows(trials));
  await replaceTab(api, spreadsheetId, "Questions", rows(questions));
  await replaceTab(api, spreadsheetId, "Follow_up", rows(followUp));
  await replaceTab(api, spreadsheetId, "Config", rows(products));
  await replaceTab(api, spreadsheetId, "Dashboard", [
    ["Metric", "Value"],
    ...Object.entries({ ...(dashboard[0] ?? {}), ...(questionMetrics[0] ?? {}) }).map(([key, value]) => [key, cell(value)]),
    ["updated_at", new Date().toISOString()],
  ]);
  return { enabled: true, rows: users.length + events.length + trials.length + questions.length };
}
