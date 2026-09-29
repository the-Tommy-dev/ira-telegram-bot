export type TgUser = {
  id: number;
  is_bot?: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
};

export type TgChat = { id: number; type: string };

export type TgMessage = {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  caption?: string;
  voice?: unknown;
  video?: unknown;
  video_note?: unknown;
  audio?: unknown;
  document?: unknown;
  photo?: unknown[];
  contact?: { phone_number: string; user_id?: number };
};

export type TgCallbackQuery = {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
};

export type TgUpdate = {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
};

export type InlineKeyboardButton = {
  text: string;
  callback_data?: string;
  url?: string;
};

export type InlineKeyboardMarkup = { inline_keyboard: InlineKeyboardButton[][] };
