import { db, type DbProduct, type DbUser } from "@/lib/db";
import { env, isAdmin } from "@/lib/env";
import {
  answerCallbackQuery,
  copyMessage,
  sendMessage,
  sendPhoto,
  sendVideoNote,
} from "@/lib/telegram/api";
import { homeRow, introMenu, mainMenu, selfWorkMenu, withNavigation } from "@/lib/telegram/keyboards";
import type { InlineKeyboardMarkup, TgCallbackQuery, TgMessage, TgUpdate, TgUser } from "@/lib/telegram/types";
import { html, parseStartParameter, splitCommand } from "@/lib/tracking";

const selfLabels: Record<string, string> = {
  feel: "Хочу больше чувствовать жизнь и себя",
  tension: "Я многое могу, но всё через напряжение",
  repeat: "В моей жизни повторяется болезненная ситуация",
  contact: "Хочу регулярно быть в контакте с собой",
  situation: "Хочу сама разобраться с конкретной ситуацией",
  cards: "Хочу работать с собой через карты",
  unknown: "Не знаю, что выбрать",
};

async function claimUpdate(updateId: number) {
  const sql = db();
  const rows = await sql`
    INSERT INTO processed_updates (update_id) VALUES (${updateId})
    ON CONFLICT DO NOTHING RETURNING update_id
  `;
  return rows.length === 1;
}

export async function releaseUpdate(updateId: number) {
  await db()`DELETE FROM processed_updates WHERE update_id = ${updateId}`;
}

async function upsertUser(from: TgUser, startParameter?: string): Promise<DbUser> {
  const sql = db();
  const parsed = parseStartParameter(startParameter);
  const [user] = await sql<DbUser[]>`
    INSERT INTO users (
      telegram_user_id, first_name, last_name, username,
      entry_source, entry_campaign, start_parameter_raw
    ) VALUES (
      ${String(from.id)}, ${from.first_name}, ${from.last_name ?? null}, ${from.username ?? null},
      ${parsed.source}, ${parsed.campaign}, ${startParameter ?? null}
    )
    ON CONFLICT (telegram_user_id) DO UPDATE SET
      first_name = EXCLUDED.first_name,
      last_name = EXCLUDED.last_name,
      username = EXCLUDED.username,
      last_activity_at = now(),
      updated_at = now()
    RETURNING telegram_user_id::text, first_name, last_name, username,
      current_flow, current_stage, active_trial_id::text, session
  `;
  return user;
}

async function logEvent(
  userId: string | number,
  eventName: string,
  data: {
    flowId?: string;
    stageId?: string;
    stageNumber?: number;
    productId?: string;
    trialId?: string;
    touchNumber?: number;
    buttonId?: string;
    metadata?: Record<string, unknown>;
  } = {},
) {
  const sql = db();
  await sql`
    INSERT INTO events (
      telegram_user_id, event_name, flow_id, stage_id, stage_number,
      product_id, trial_id, touch_number, button_id, metadata
    ) VALUES (
      ${String(userId)}, ${eventName}, ${data.flowId ?? null}, ${data.stageId ?? null},
      ${data.stageNumber ?? null}, ${data.productId ?? null}, ${data.trialId ?? null},
      ${data.touchNumber ?? null}, ${data.buttonId ?? null}, ${sql.json((data.metadata ?? {}) as Parameters<typeof sql.json>[0])}
    )
  `;
  await sql`
    UPDATE users SET last_event = ${eventName}, last_activity_at = now(), updated_at = now()
    WHERE telegram_user_id = ${String(userId)}
  `;
}

async function setStage(
  userId: string | number,
  flow: string,
  stage: string,
  stageNumber: number,
  productId?: string,
) {
  await db()`
    UPDATE users SET
      first_flow = COALESCE(first_flow, ${flow}),
      current_flow = ${flow}, current_stage = ${stage}, stage_number = ${stageNumber},
      last_product_id = COALESCE(${productId ?? null}, last_product_id), updated_at = now()
    WHERE telegram_user_id = ${String(userId)}
  `;
}

async function showMainMenu(chatId: number, userId: number, withPhoto = false) {
  await setStage(userId, "main", "menu", 0);
  const caption = "Добро пожаловать. Здесь можно познакомиться с Ирой, посмотреть форматы работы или начать с того, что сейчас волнует.";
  const photo = env().INTRO_PHOTO_FILE_ID || (env().PUBLIC_BASE_URL ? `${env().PUBLIC_BASE_URL}/ira-intro.png` : undefined);
  if (withPhoto && photo) await sendPhoto(chatId, photo, caption, mainMenu);
  else await sendMessage(chatId, caption, mainMenu);
}

async function showSelfWork(chatId: number, userId: number) {
  await setStage(userId, "self", "request", 1);
  await logEvent(userId, "flow_selected", { flowId: "self", stageId: "request", stageNumber: 1 });
  await sendMessage(chatId, "Что сейчас больше всего похоже на тебя?", selfWorkMenu);
}

async function getProducts(): Promise<DbProduct[]> {
  return db()<DbProduct[]>`
    SELECT product_id, title, short_description, format, duration, price, cover,
      details_url, purchase_url, booking_url, trial_enabled, active, sort_order
    FROM products WHERE active = true ORDER BY sort_order, title
  `;
}

async function showProducts(chatId: number, userId: number) {
  const products = await getProducts();
  await setStage(userId, "products", "list", 1);
  await logEvent(userId, "flow_selected", { flowId: "products", stageId: "list", stageNumber: 1 });
  const rows = products.map((product) => [{ text: product.title, callback_data: `product:${product.product_id}` }]);
  rows.push([{ text: "Расписание", callback_data: "schedule" }]);
  await sendMessage(chatId, "Выбери продукт, услугу или посмотри расписание:", withNavigation(rows, "home"));
}

async function createTrackedUrl(
  userId: number,
  productId: string,
  purpose: string,
  destinationUrl: string,
  trialId?: string,
) {
  const [row] = await db()<Array<{ token: string }>>`
    INSERT INTO outbound_links (telegram_user_id, product_id, trial_id, purpose, destination_url)
    VALUES (${String(userId)}, ${productId}, ${trialId ?? null}, ${purpose}, ${destinationUrl})
    RETURNING token::text
  `;
  return env().PUBLIC_BASE_URL ? `${env().PUBLIC_BASE_URL}/api/go/${row.token}` : destinationUrl;
}

async function showProduct(chatId: number, userId: number, productId: string) {
  const [product] = await db()<DbProduct[]>`
    SELECT product_id, title, short_description, format, duration, price, cover,
      details_url, purchase_url, booking_url, trial_enabled, active, sort_order
    FROM products WHERE product_id = ${productId} AND active = true
  `;
  if (!product) {
    await sendMessage(chatId, "Этот раздел сейчас недоступен.", { inline_keyboard: [homeRow] });
    return;
  }
  await setStage(userId, "products", "product", 2, product.product_id);
  await db()`
    UPDATE users SET interested_products =
      CASE WHEN ${product.product_id} = ANY(interested_products) THEN interested_products
      ELSE array_append(interested_products, ${product.product_id}) END
    WHERE telegram_user_id = ${String(userId)}
  `;
  await logEvent(userId, "product_viewed", { flowId: "products", stageId: "product", stageNumber: 2, productId });

  const lines = [`<b>${html(product.title)}</b>`];
  if (product.short_description) lines.push(html(product.short_description));
  if (product.format) lines.push(`<b>Формат:</b> ${html(product.format)}`);
  if (product.duration) lines.push(`<b>Продолжительность:</b> ${html(product.duration)}`);
  if (product.price) lines.push(`<b>Стоимость:</b> ${html(product.price)}`);

  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  if (product.trial_enabled) rows.push([{ text: "Попробовать бесплатно", callback_data: `trial:${product.product_id}` }]);
  const purchaseUrl = product.purchase_url ?? product.booking_url;
  if (purchaseUrl) {
    rows.push([{ text: product.booking_url ? "Записаться" : "Присоединиться", url: await createTrackedUrl(userId, productId, "purchase", purchaseUrl) }]);
  }
  if (product.details_url) rows.push([{ text: "Подробнее", url: await createTrackedUrl(userId, productId, "details", product.details_url) }]);
  rows.push([{ text: "Задать вопрос", callback_data: `askp:${product.product_id}` }]);
  const keyboard = withNavigation(rows, "products");
  if (product.cover) await sendPhoto(chatId, product.cover, lines.join("\n\n"), keyboard);
  else await sendMessage(chatId, lines.join("\n\n"), keyboard);
}

async function showIntro(chatId: number, userId: number) {
  await setStage(userId, "intro", "about", 1);
  await logEvent(userId, "flow_selected", { flowId: "intro", stageId: "about", stageNumber: 1 });
  await sendMessage(chatId, "Ира помогает бережно возвращаться к себе, замечать повторяющиеся сценарии и находить следующий подходящий шаг.");
  const videoNote = env().INTRO_VIDEO_NOTE_FILE_ID;
  if (videoNote) await sendVideoNote(chatId, videoNote);
  await sendMessage(
    chatId,
    "Можно познакомиться с практикумами, картами и личной работой — или сначала выбрать бесплатный формат.",
    introMenu,
  );
}

async function showSchedule(chatId: number, userId: number) {
  const events = await db()<Array<Record<string, unknown>>>`
    SELECT event_id, title, start_at, end_at, short_description, details_url, join_url
    FROM schedule_events
    WHERE status IN ('upcoming','open','ongoing')
      AND (end_at IS NULL OR end_at >= now())
    ORDER BY sort_order, start_at NULLS LAST
  `;
  await setStage(userId, "schedule", "list", 1);
  if (!events.length) {
    await sendMessage(chatId, "Сейчас расписание уточняется.", withNavigation([[{ text: "Все продукты", callback_data: "products" }]], "home"));
    return;
  }
  await sendMessage(chatId, "<b>Что сейчас происходит у Иры</b>");
  for (const item of events) {
    const lines = [`<b>${html(item.title)}</b>`];
    if (item.start_at) lines.push(new Date(String(item.start_at)).toLocaleString("ru-RU", { timeZone: env().BOT_TIMEZONE }));
    if (item.short_description) lines.push(html(item.short_description));
    const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
    if (item.details_url) rows.push([{ text: "Подробнее", url: String(item.details_url) }]);
    if (item.join_url) rows.push([{ text: "Присоединиться", url: String(item.join_url) }]);
    await sendMessage(chatId, lines.join("\n\n"), { inline_keyboard: rows.length ? rows : [homeRow] });
  }
  await sendMessage(chatId, "Куда дальше?", withNavigation([[{ text: "Все продукты", callback_data: "products" }]], "home"));
}

async function showOffers(chatId: number, userId: number) {
  const offers = await db()<Array<Record<string, unknown>>>`
    SELECT offer_id, category, title, short_description, cta_label, cta_url, target_flow, product_id
    FROM offers WHERE active = true
      AND (active_from IS NULL OR active_from <= now())
      AND (active_until IS NULL OR active_until >= now())
    ORDER BY sort_order, title
  `;
  await setStage(userId, "offers", "list", 1);
  if (!offers.length) {
    await sendMessage(chatId, "Актуальные предложения скоро появятся здесь.", withNavigation([
      [{ text: "Расписание", callback_data: "schedule" }],
      [{ text: "Все продукты", callback_data: "products" }],
    ], "flow:intro"));
    return;
  }
  await sendMessage(chatId, "<b>Сейчас у Иры можно:</b>");
  for (const offer of offers) {
    const text = `<b>${html(offer.title)}</b>${offer.short_description ? `\n\n${html(offer.short_description)}` : ""}`;
    const button = offer.cta_url
      ? { text: String(offer.cta_label ?? "Подробнее"), url: String(offer.cta_url) }
      : { text: String(offer.cta_label ?? "Открыть"), callback_data: offer.product_id ? `product:${offer.product_id}` : String(offer.target_flow ?? "home") };
    await sendMessage(chatId, text, { inline_keyboard: [[button]] });
  }
  await sendMessage(chatId, "Куда дальше?", withNavigation([
    [{ text: "Расписание", callback_data: "schedule" }],
    [{ text: "Все продукты", callback_data: "products" }],
  ], "flow:intro"));
}

type TouchContent = { text: string; kind: "material" | "final" };

function touchTemplates(productTitle: string): Array<{ day: number; content: TouchContent }> {
  return [
    { day: 0, content: { kind: "material", text: `Твоя бесплатная неделя «${productTitle}» началась.\n\nПервый материал появится здесь. Можно идти в своём темпе.` } },
    { day: 3, content: { kind: "material", text: `Второе касание практикума «${productTitle}».\n\nЗаметь, что отозвалось после первого знакомства, и переходи к следующему материалу.` } },
    { day: 6, content: { kind: "material", text: `Третье касание практикума «${productTitle}».\n\nСегодня можно собрать наблюдения и попробовать заключительную практику недели.` } },
    { day: 7, content: { kind: "final", text: `Бесплатная неделя «${productTitle}» завершилась. Давай коротко отметим, как она прошла.` } },
  ];
}

async function startTrial(chatId: number, userId: number, productId: string) {
  const sql = db();
  let trialId = "";
  let productTitle = "";
  try {
    await sql.begin(async (tx) => {
      const [user] = await tx<Array<{ active_trial_id: string | null }>>`
        SELECT active_trial_id::text FROM users WHERE telegram_user_id = ${String(userId)} FOR UPDATE
      `;
      if (user?.active_trial_id) throw new Error("ACTIVE_TRIAL");
      const [product] = await tx<Array<{ title: string; trial_enabled: boolean }>>`
        SELECT title, trial_enabled FROM products WHERE product_id = ${productId} AND active = true
      `;
      if (!product?.trial_enabled) throw new Error("TRIAL_UNAVAILABLE");
      productTitle = product.title;
      const [trial] = await tx<Array<{ trial_id: string }>>`
        INSERT INTO trials (telegram_user_id, product_id, scheduled_end_at)
        VALUES (${String(userId)}, ${productId}, now() + interval '7 days')
        RETURNING trial_id::text
      `;
      trialId = trial.trial_id;
      for (const [index, template] of touchTemplates(product.title).entries()) {
        await tx`
          INSERT INTO trial_touches (trial_id, touch_number, due_at, kind, content)
          VALUES (${trialId}, ${index}, now() + (${template.day} * interval '1 day'), ${template.content.kind}, ${tx.json(template.content)})
        `;
      }
      await tx`
        UPDATE users SET active_trial_id = ${trialId}, trials_started_count = trials_started_count + 1,
          last_product_id = ${productId}, current_flow = 'trial', current_stage = 'active', updated_at = now()
        WHERE telegram_user_id = ${String(userId)}
      `;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "ACTIVE_TRIAL" || message.includes("one_active_trial_per_user")) {
      await sendMessage(chatId, "У тебя уже идёт бесплатная неделя. Сначала заверши или останови её.", {
        inline_keyboard: [[{ text: "Остановить текущую неделю", callback_data: "stoptrial" }], homeRow],
      });
      return;
    }
    if (message === "TRIAL_UNAVAILABLE") {
      await sendMessage(chatId, "Бесплатная неделя для этого продукта сейчас недоступна.", { inline_keyboard: [homeRow] });
      return;
    }
    throw error;
  }
  await logEvent(userId, "trial_started", { productId, trialId, touchNumber: 0 });
  await deliverTrialTouch(trialId, 0, true);
  await sendMessage(chatId, `Неделя «${html(productTitle)}» активна. Следующие касания придут автоматически.`, {
    inline_keyboard: [
      [{ text: "Спросить лично у Иры", callback_data: `ask:${trialId}:0` }],
      [{ text: "Остановить неделю", callback_data: "stoptrial" }],
      homeRow,
    ],
  });
}

export async function deliverTrialTouch(trialId: string, touchNumber: number, immediate = false) {
  const sql = db();
  const [touch] = await sql<Array<{
    telegram_user_id: string;
    product_id: string;
    title: string;
    status: string;
    attempt_count: number;
    kind: string;
    content: TouchContent;
  }>>`
    UPDATE trial_touches tt SET status = 'processing', locked_at = now(), attempt_count = attempt_count + 1
    FROM trials t, products p
    WHERE tt.trial_id = ${trialId} AND tt.touch_number = ${touchNumber}
      AND tt.trial_id = t.trial_id AND t.product_id = p.product_id
      AND t.status IN ('active','scheduled')
      AND tt.status IN ('pending','failed')
      AND (${immediate} OR tt.due_at <= now())
    RETURNING t.telegram_user_id::text, t.product_id, p.title, tt.status, tt.attempt_count, tt.kind, tt.content
  `;
  if (!touch) return false;
  try {
    const keyboard: InlineKeyboardMarkup = touch.kind === "final"
      ? { inline_keyboard: [
          [{ text: "Прошла всё", callback_data: `fb1:${trialId}:all` }],
          [{ text: "Попробовала часть", callback_data: `fb1:${trialId}:part` }],
          [{ text: "Пока только познакомилась", callback_data: `fb1:${trialId}:intro` }],
          [{ text: "Спросить лично у Иры", callback_data: `ask:${trialId}:${touchNumber}` }],
          homeRow,
        ] }
      : { inline_keyboard: [
          [{ text: "Посмотрела / Сделала", callback_data: `done:${trialId}:${touchNumber}` }],
          [{ text: "Вернусь позже", callback_data: `later:${trialId}:${touchNumber}` }],
          [{ text: "Спросить лично у Иры", callback_data: `ask:${trialId}:${touchNumber}` }],
          homeRow,
        ] };
    await sendMessage(touch.telegram_user_id, touch.content.text, keyboard);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE trial_touches SET status = 'sent', sent_at = now(), error = null
        WHERE trial_id = ${trialId} AND touch_number = ${touchNumber}
      `;
      await tx`
        UPDATE trials SET current_touch = GREATEST(current_touch, ${touchNumber}), updated_at = now()
        WHERE trial_id = ${trialId}
      `;
      if (touch.kind === "final") {
        await tx`
          UPDATE trials SET status = 'completed', completed_at = now(), feedback_status = 'pending', updated_at = now()
          WHERE trial_id = ${trialId}
        `;
        await tx`
          UPDATE users SET active_trial_id = null, trials_completed_count = trials_completed_count + 1,
            trial_products = CASE WHEN ${touch.product_id} = ANY(trial_products) THEN trial_products ELSE array_append(trial_products, ${touch.product_id}) END,
            current_stage = 'feedback', updated_at = now()
          WHERE telegram_user_id = ${touch.telegram_user_id}
        `;
      }
      await tx`
        INSERT INTO events (telegram_user_id, event_name, product_id, trial_id, touch_number, content_type)
        VALUES (${touch.telegram_user_id}, ${touch.kind === "final" ? "trial_completed" : "trial_touch_sent"},
          ${touch.product_id}, ${trialId}, ${touchNumber}, ${touch.kind})
      `;
    });
    return true;
  } catch (error) {
    const description = error instanceof Error ? error.message.slice(0, 1000) : "Unknown Telegram error";
    const unreachable = /403|blocked|chat not found/i.test(description);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE trial_touches SET status = ${unreachable || touch.attempt_count >= 3 ? "cancelled" : "failed"}, error = ${description}
        WHERE trial_id = ${trialId} AND touch_number = ${touchNumber}
      `;
      if (unreachable) {
        await tx`UPDATE trials SET status = 'unreachable', updated_at = now() WHERE trial_id = ${trialId}`;
        await tx`UPDATE users SET active_trial_id = null, updated_at = now() WHERE telegram_user_id = ${touch.telegram_user_id}`;
        await tx`
          INSERT INTO events (telegram_user_id, event_name, product_id, trial_id, touch_number)
          VALUES (${touch.telegram_user_id}, 'bot_blocked_or_unreachable', ${touch.product_id}, ${trialId}, ${touchNumber})
        `;
      }
    });
    return false;
  }
}

async function stopTrial(chatId: number, userId: number) {
  const sql = db();
  const [trial] = await sql<Array<{ trial_id: string; product_id: string }>>`
    UPDATE trials SET status = 'cancelled', updated_at = now()
    WHERE telegram_user_id = ${String(userId)} AND status IN ('active','scheduled')
    RETURNING trial_id::text, product_id
  `;
  if (trial) {
    await sql`UPDATE trial_touches SET status = 'cancelled' WHERE trial_id = ${trial.trial_id} AND status IN ('pending','failed')`;
    await sql`UPDATE users SET active_trial_id = null, updated_at = now() WHERE telegram_user_id = ${String(userId)}`;
    await logEvent(userId, "trial_cancelled", { productId: trial.product_id, trialId: trial.trial_id });
    await sendMessage(chatId, "Автоматическая неделя остановлена. Ты всегда можешь выбрать другой формат позже.", { inline_keyboard: [homeRow] });
  } else {
    await sendMessage(chatId, "Сейчас у тебя нет активной бесплатной недели.", { inline_keyboard: [homeRow] });
  }
}

async function beginQuestion(chatId: number, userId: number, context: { productId?: string; trialId?: string; touchNumber?: number }) {
  const sql = db();
  await sql`
    UPDATE users SET session = ${sql.json({ mode: "awaiting_question", ...context })}, current_stage = 'question', updated_at = now()
    WHERE telegram_user_id = ${String(userId)}
  `;
  await logEvent(userId, "ask_ira_clicked", context);
  await sendMessage(chatId, "Напиши свой вопрос одним сообщением. Ира или участник команды ответит через этого бота.", {
    inline_keyboard: [[{ text: "Отменить вопрос", callback_data: "cancelq" }], homeRow],
  });
}

async function submitQuestion(message: TgMessage, user: DbUser) {
  const text = message.text?.trim();
  if (!text) {
    await sendMessage(message.chat.id, "Пожалуйста, отправь вопрос текстом одним сообщением.");
    return;
  }
  const context = user.session as { productId?: string; trialId?: string; touchNumber?: number };
  const sql = db();
  const [question] = await sql<Array<{ question_id: string }>>`
    INSERT INTO questions (telegram_user_id, username, product_id, trial_id, touch_number, question_text)
    VALUES (${user.telegram_user_id}, ${user.username}, ${context.productId ?? null}, ${context.trialId ?? null}, ${context.touchNumber ?? null}, ${text})
    RETURNING question_id::text
  `;
  await sql`
    UPDATE users SET session = '{}', personal_follow_up = true, follow_up_reason = 'question',
      lead_temperature = 'hot', current_stage = 'question_submitted', updated_at = now()
    WHERE telegram_user_id = ${user.telegram_user_id}
  `;
  if (context.trialId) await sql`UPDATE trials SET asked_ira = true, updated_at = now() WHERE trial_id = ${context.trialId}`;
  await sql`
    INSERT INTO follow_up (telegram_user_id, priority, reason, product_id, recommended_action, initiative)
    VALUES (${user.telegram_user_id}, 'high', 'new_question', ${context.productId ?? null}, 'Ответить', 'Задал вопрос')
    ON CONFLICT (telegram_user_id, reason, status) DO UPDATE SET updated_at = now(), priority = 'high'
  `;
  await logEvent(user.telegram_user_id, "question_submitted", { ...context, metadata: { questionId: question.question_id } });
  await sendMessage(message.chat.id, "Спасибо, вопрос получен. Ответ придёт сюда через бота.", { inline_keyboard: [homeRow] });

  const adminChatId = env().ADMIN_CHAT_ID;
  if (adminChatId) {
    const sheetUrl = env().GOOGLE_SHEET_URL;
    const sheetButton = sheetUrl ? [{ text: "Открыть таблицу", url: sheetUrl }] : [];
    const adminMessage = await sendMessage(
      adminChatId,
      `<b>Новый вопрос из бота</b>\n\nИмя: ${html(user.first_name)}\nUsername: ${user.username ? `@${html(user.username)}` : "не указан"}\nTelegram ID: <code>${html(user.telegram_user_id)}</code>\nПродукт: ${html(context.productId ?? "не указан")}\nКасание: ${html(context.touchNumber ?? "—")}\n\n<b>Вопрос:</b>\n${html(text)}`,
      { inline_keyboard: [
        [{ text: "Ответить через бота", callback_data: `qreply:${question.question_id}` }],
        ...(sheetButton.length ? [sheetButton] : []),
        [{ text: "Отметить решённым", callback_data: `qclose:${question.question_id}` }],
      ] },
    );
    await sql`UPDATE questions SET ira_telegram_message_id = ${adminMessage.message_id} WHERE question_id = ${question.question_id}`;
  }
}

async function handleAdminMessage(message: TgMessage) {
  if (!message.from || !isAdmin(message.from.id)) return false;
  const sql = db();
  const [session] = await sql<Array<{ action: string; question_id: string; payload: Record<string, unknown> }>>`
    SELECT action, question_id::text, payload FROM admin_sessions WHERE admin_user_id = ${String(message.from.id)}
  `;
  if (!session || session.action !== "awaiting_reply") return false;
  const supported = message.text || message.voice || message.video || message.video_note || message.audio || message.document || message.photo;
  if (!supported) {
    await sendMessage(message.chat.id, "Этот тип ответа пока не поддерживается. Отправьте текст, voice, video, video note, аудио, документ или фото.");
    return true;
  }
  const payload = { chatId: message.chat.id, messageId: message.message_id, answerText: message.text ?? message.caption ?? null };
  await sql`
    UPDATE admin_sessions SET action = 'confirm_reply', payload = ${sql.json(payload)}, updated_at = now()
    WHERE admin_user_id = ${String(message.from.id)}
  `;
  await sendMessage(message.chat.id, "Отправить этот ответ пользователю?", {
    inline_keyboard: [
      [{ text: "Отправить", callback_data: `qsend:${session.question_id}` }],
      [{ text: "Отмена", callback_data: `qcancel:${session.question_id}` }],
    ],
  });
  return true;
}

async function handleAdminCallback(query: TgCallbackQuery, data: string) {
  if (!isAdmin(query.from.id) || !query.message) return false;
  const [action, questionId] = data.split(":", 2);
  if (!questionId || !["qreply", "qsend", "qcancel", "qclose"].includes(action)) return false;
  const sql = db();
  if (action === "qreply") {
    await sql`
      INSERT INTO admin_sessions (admin_user_id, action, question_id)
      VALUES (${String(query.from.id)}, 'awaiting_reply', ${questionId})
      ON CONFLICT (admin_user_id) DO UPDATE SET action = 'awaiting_reply', question_id = EXCLUDED.question_id, payload = '{}', updated_at = now()
    `;
    await sql`UPDATE questions SET status = 'in_progress', assigned_to = ${String(query.from.id)}, updated_at = now() WHERE question_id = ${questionId}`;
    await sendMessage(query.message.chat.id, "Отправьте ответ следующим сообщением. Поддерживаются текст, voice, video, video note, аудио, документ и фото.");
  } else if (action === "qsend") {
    const [session] = await sql<Array<{ payload: { chatId: number; messageId: number; answerText?: string }; telegram_user_id: string }>>`
      SELECT s.payload, q.telegram_user_id::text
      FROM admin_sessions s JOIN questions q ON q.question_id = s.question_id
      WHERE s.admin_user_id = ${String(query.from.id)} AND s.question_id = ${questionId} AND s.action = 'confirm_reply'
    `;
    if (!session) {
      await answerCallbackQuery(query.id, "Черновик ответа не найден", true);
      return true;
    }
    await copyMessage(session.telegram_user_id, session.payload.chatId, session.payload.messageId);
    await sql.begin(async (tx) => {
      await tx`
        UPDATE questions SET status = 'answered', answer_text = ${session.payload.answerText ?? null}, answered_at = now(), updated_at = now()
        WHERE question_id = ${questionId}
      `;
      await tx`DELETE FROM admin_sessions WHERE admin_user_id = ${String(query.from.id)}`;
      await tx`
        INSERT INTO events (telegram_user_id, event_name, metadata)
        VALUES (${session.telegram_user_id}, 'ira_reply_sent', ${tx.json({ questionId })})
      `;
    });
    await sendMessage(query.message.chat.id, "Ответ отправлен пользователю.");
  } else if (action === "qcancel") {
    await sql`DELETE FROM admin_sessions WHERE admin_user_id = ${String(query.from.id)}`;
    await sendMessage(query.message.chat.id, "Отправка отменена.");
  } else {
    await sql`UPDATE questions SET status = 'closed', updated_at = now() WHERE question_id = ${questionId}`;
    await sendMessage(query.message.chat.id, "Вопрос отмечен решённым.");
  }
  await answerCallbackQuery(query.id);
  return true;
}

async function handleFeedback(chatId: number, userId: number, data: string) {
  const [step, trialId, answer] = data.split(":", 3);
  const sql = db();
  const [trial] = await sql<Array<{ product_id: string }>>`
    SELECT product_id FROM trials WHERE trial_id = ${trialId} AND telegram_user_id = ${String(userId)}
  `;
  if (!trial) return false;
  if (step === "fb1") {
    await sql`
      UPDATE trials SET feedback_answer = feedback_answer || ${sql.json({ completion: answer })}, updated_at = now()
      WHERE trial_id = ${trialId}
    `;
    await sendMessage(chatId, "Что замечаешь сейчас?", { inline_keyboard: [
      [{ text: "Уже чувствую изменения", callback_data: `fb2:${trialId}:changes` }],
      [{ text: "Хочу пойти глубже", callback_data: `fb2:${trialId}:deeper` }],
      [{ text: "Появился вопрос", callback_data: `ask:${trialId}:3` }],
      [{ text: "Пока присматриваюсь", callback_data: `fb2:${trialId}:watching` }],
      homeRow,
    ] });
  } else {
    await sql`
      UPDATE trials SET feedback_answer = feedback_answer || ${sql.json({ result: answer })}, feedback_status = 'answered', updated_at = now()
      WHERE trial_id = ${trialId}
    `;
    if (answer === "deeper") {
      await sql`
        INSERT INTO follow_up (telegram_user_id, priority, reason, product_id, recommended_action, initiative)
        VALUES (${String(userId)}, 'high', 'wants_deeper', ${trial.product_id}, 'Предложить следующий шаг', 'Попросил продолжение')
        ON CONFLICT (telegram_user_id, reason, status) DO UPDATE SET updated_at = now()
      `;
    }
    await logEvent(userId, "trial_feedback_answered", { productId: trial.product_id, trialId, metadata: { answer } });
    await sendMessage(chatId, "Спасибо, что поделилась. Хочешь продолжить полный практикум?", { inline_keyboard: [
      [{ text: "Да, хочу пройти дальше", callback_data: `continue:${trial.product_id}:${trialId}` }],
      [{ text: "Сначала узнать подробнее", callback_data: `product:${trial.product_id}` }],
      [{ text: "Спросить лично у Иры", callback_data: `ask:${trialId}:3` }],
      [{ text: "Пока не готова", callback_data: "home" }],
    ] });
  }
  return true;
}

async function deleteUser(chatId: number, userId: number) {
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`DELETE FROM events WHERE telegram_user_id = ${String(userId)}`;
    await tx`DELETE FROM processed_updates WHERE update_id IN (SELECT update_id FROM processed_updates WHERE false)`;
    await tx`DELETE FROM users WHERE telegram_user_id = ${String(userId)}`;
  });
  await sendMessage(chatId, "Твои данные и история прохождения удалены. Если захочешь вернуться, отправь /start.");
}

async function handleCallback(query: TgCallbackQuery) {
  if (!query.message || !query.data) return;
  const data = query.data;
  if (await handleAdminCallback(query, data)) return;
  await answerCallbackQuery(query.id).catch(() => undefined);
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  await logEvent(userId, data === "home" ? "home_clicked" : data.startsWith("back:") ? "back_clicked" : "button_clicked", { buttonId: data });

  if (data === "home") return showMainMenu(chatId, userId);
  if (data === "flow:self") return showSelfWork(chatId, userId);
  if (data === "flow:products" || data === "products") return showProducts(chatId, userId);
  if (data === "flow:intro") return showIntro(chatId, userId);
  if (data === "schedule") return showSchedule(chatId, userId);
  if (data === "offers") return showOffers(chatId, userId);
  if (data === "stoptrial") return stopTrial(chatId, userId);
  if (data === "cancelq") {
    await db()`UPDATE users SET session = '{}', updated_at = now() WHERE telegram_user_id = ${String(userId)}`;
    return sendMessage(chatId, "Вопрос отменён.", { inline_keyboard: [homeRow] });
  }
  if (data === "delete:confirm") return deleteUser(chatId, userId);
  if (data.startsWith("product:")) return showProduct(chatId, userId, data.slice(8));
  if (data.startsWith("trial:")) return startTrial(chatId, userId, data.slice(6));
  if (data.startsWith("self:")) {
    const choice = data.slice(5);
    if (!selfLabels[choice]) return;
    await setStage(userId, "self", `request_${choice}`, 2);
    await logEvent(userId, "self_request_selected", { flowId: "self", stageId: choice, stageNumber: 2, metadata: { label: selfLabels[choice] } });
    return sendMessage(chatId, "Спасибо. Я сохранила этот выбор. Рекомендации по этой ветке появятся после утверждения карты соответствий.", withNavigation([
      [{ text: "Посмотреть продукты", callback_data: "products" }],
      [{ text: "Задать вопрос", callback_data: "askp:none" }],
    ], "flow:self"));
  }
  if (data.startsWith("askp:")) return beginQuestion(chatId, userId, { productId: data.slice(5) === "none" ? undefined : data.slice(5) });
  if (data.startsWith("ask:")) {
    const [, trialId, touch] = data.split(":", 3);
    const [trial] = await db()<Array<{ product_id: string }>>`
      SELECT product_id FROM trials WHERE trial_id = ${trialId} AND telegram_user_id = ${String(userId)}
    `;
    if (!trial) return sendMessage(chatId, "Эта неделя больше недоступна.", { inline_keyboard: [homeRow] });
    return beginQuestion(chatId, userId, { productId: trial.product_id, trialId, touchNumber: Number(touch) });
  }
  if (data.startsWith("done:") || data.startsWith("later:")) {
    const [choice, trialId, touchRaw] = data.split(":", 3);
    const touchNumber = Number(touchRaw);
    await db()`
      UPDATE trial_touches tt SET clicked_at = now()
      FROM trials t
      WHERE tt.trial_id = ${trialId} AND tt.touch_number = ${touchNumber}
        AND t.trial_id = tt.trial_id AND t.telegram_user_id = ${String(userId)}
    `;
    await logEvent(userId, "trial_content_clicked", { trialId, touchNumber, metadata: { choice } });
    return sendMessage(chatId, choice === "done" ? "Отмечено. Бережно продолжай в своём темпе." : "Хорошо, материал останется в чате — можно вернуться позже.", { inline_keyboard: [homeRow] });
  }
  if (data.startsWith("fb1:") || data.startsWith("fb2:")) {
    if (await handleFeedback(chatId, userId, data)) return;
  }
  if (data.startsWith("continue:")) {
    const [, productId, trialId] = data.split(":", 3);
    await db()`UPDATE trials SET continuation_clicked = true, updated_at = now() WHERE trial_id = ${trialId} AND telegram_user_id = ${String(userId)}`;
    await logEvent(userId, "continue_clicked", { productId, trialId });
    return showProduct(chatId, userId, productId);
  }
  await sendMessage(chatId, "Эта кнопка устарела. Вернись в главное меню.", { inline_keyboard: [homeRow] });
}

async function handleMessage(message: TgMessage, user: DbUser) {
  if (await handleAdminMessage(message)) return;
  const { command, parameter } = splitCommand(message.text);
  if (command === "/start") {
    const parsed = parseStartParameter(parameter);
    await logEvent(user.telegram_user_id, "bot_started", { metadata: { startParameter: parameter ?? null, ...parsed } });
    if (parsed.productId) return showProduct(message.chat.id, message.from!.id, parsed.productId);
    return showMainMenu(message.chat.id, message.from!.id, true);
  }
  if (command === "/menu" || command === "/help") return showMainMenu(message.chat.id, message.from!.id);
  if (command === "/stop") return stopTrial(message.chat.id, message.from!.id);
  if (command === "/privacy") {
    return sendMessage(message.chat.id, "Бот хранит Telegram ID, имя, выбранные разделы, прохождение материалов и вопросы, чтобы продолжать диалог и показывать команде прогресс. Для удаления данных используй /delete_me.", { inline_keyboard: [homeRow] });
  }
  if (command === "/delete_me") {
    return sendMessage(message.chat.id, "Удалить твои данные, вопросы и историю прохождения? Это действие нельзя отменить.", {
      inline_keyboard: [[{ text: "Да, удалить", callback_data: "delete:confirm" }], [{ text: "Отмена", callback_data: "home" }]],
    });
  }
  if ((user.session as { mode?: string }).mode === "awaiting_question") return submitQuestion(message, user);
  if (message.contact && (!message.contact.user_id || message.contact.user_id === message.from?.id)) {
    await db()`UPDATE users SET phone = ${message.contact.phone_number}, updated_at = now() WHERE telegram_user_id = ${user.telegram_user_id}`;
    return sendMessage(message.chat.id, "Спасибо, номер сохранён.", { inline_keyboard: [homeRow] });
  }
  await sendMessage(message.chat.id, "Выбери действие с помощью кнопок меню.", mainMenu);
}

export async function handleTelegramUpdate(update: TgUpdate) {
  if (!(await claimUpdate(update.update_id))) return;
  try {
    const from = update.callback_query?.from ?? update.message?.from;
    if (!from || from.is_bot) return;
    const startParameter = update.message ? splitCommand(update.message.text).parameter : undefined;
    const user = await upsertUser(from, startParameter);
    if (update.callback_query) await handleCallback(update.callback_query);
    else if (update.message) await handleMessage(update.message, user);
  } catch (error) {
    await releaseUpdate(update.update_id);
    throw error;
  }
}
