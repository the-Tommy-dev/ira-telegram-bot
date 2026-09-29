import type { InlineKeyboardMarkup } from "@/lib/telegram/types";

export const mainMenu: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: "Хочу поработать с собой", callback_data: "flow:self" }],
    [{ text: "Я уже знаю, куда хочу", callback_data: "flow:products" }],
    [{ text: "Хочу познакомиться с Ирой", callback_data: "flow:intro" }],
  ],
};

export const homeRow = [{ text: "🏠 Главное меню", callback_data: "home" }];

export function withNavigation(
  rows: InlineKeyboardMarkup["inline_keyboard"],
  back: string,
): InlineKeyboardMarkup {
  return {
    inline_keyboard: [...rows, [{ text: "← Назад", callback_data: back }], homeRow],
  };
}

export const selfWorkMenu = withNavigation(
  [
    [{ text: "Хочу больше чувствовать жизнь и себя", callback_data: "self:feel" }],
    [{ text: "Я многое могу, но всё через напряжение", callback_data: "self:tension" }],
    [{ text: "В моей жизни повторяется болезненная ситуация", callback_data: "self:repeat" }],
    [{ text: "Хочу регулярно быть в контакте с собой", callback_data: "self:contact" }],
    [{ text: "Хочу сама разобраться с конкретной ситуацией", callback_data: "self:situation" }],
    [{ text: "Хочу работать с собой через карты", callback_data: "self:cards" }],
    [{ text: "Не знаю, что выбрать", callback_data: "self:unknown" }],
  ],
  "home",
);

export const introMenu = withNavigation(
  [
    [{ text: "Что доступно сейчас", callback_data: "offers" }],
    [{ text: "Посмотреть расписание", callback_data: "schedule" }],
    [{ text: "Посмотреть все продукты", callback_data: "products" }],
    [{ text: "Хочу поработать с собой", callback_data: "flow:self" }],
    [{ text: "Бесплатная практика", callback_data: "product:free_body_meditation" }],
  ],
  "home",
);
