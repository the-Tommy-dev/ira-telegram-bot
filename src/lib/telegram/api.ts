import { requireEnv } from "@/lib/env";
import type { InlineKeyboardMarkup } from "@/lib/telegram/types";

type ApiResponse<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string };

export class TelegramError extends Error {
  constructor(public code: number, message: string) {
    super(message);
  }
}

export async function telegram<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${requireEnv("BOT_TOKEN")}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = (await response.json()) as ApiResponse<T>;
  if (!data.ok) throw new TelegramError(data.error_code, data.description);
  return data.result;
}

export function sendMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
) {
  return telegram<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function sendPhoto(
  chatId: string | number,
  photo: string,
  caption?: string,
  replyMarkup?: InlineKeyboardMarkup,
) {
  return telegram<{ message_id: number }>("sendPhoto", {
    chat_id: chatId,
    photo,
    ...(caption ? { caption, parse_mode: "HTML" } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
}

export function sendVideoNote(chatId: string | number, videoNote: string) {
  return telegram<{ message_id: number }>("sendVideoNote", {
    chat_id: chatId,
    video_note: videoNote,
  });
}

export function answerCallbackQuery(callbackQueryId: string, text?: string, showAlert = false) {
  return telegram<boolean>("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: showAlert } : {}),
  });
}

export function copyMessage(
  chatId: string | number,
  fromChatId: string | number,
  messageId: number,
) {
  return telegram<{ message_id: number }>("copyMessage", {
    chat_id: chatId,
    from_chat_id: fromChatId,
    message_id: messageId,
  });
}
