import type { InlineKeyboardMarkup } from './types.js';

export function inlineKeyboard(
  rows: InlineKeyboardMarkup['inline_keyboard'],
): InlineKeyboardMarkup {
  return { inline_keyboard: rows };
}

export const mainMenu = inlineKeyboard([
  [{ text: '🎁 Получить комплекс упражнений', callback_data: 'complexes' }],
  [{ text: '💆 Массаж', callback_data: 'flow:massage' }],
  [{ text: '🤸 ЛФК', callback_data: 'flow:exercise_therapy' }],
  [{ text: '🤔 Не знаю, что выбрать', callback_data: 'flow:advice' }],
]);

export const complexesMenu = inlineKeyboard([
  [{ text: 'Комплекс №1', callback_data: 'complex:1' }],
  [{ text: 'Комплекс №2', callback_data: 'complex:2' }],
  [{ text: '← Главное меню', callback_data: 'menu' }],
]);

export const massageTypes = inlineKeyboard([
  [{ text: 'Спина и шея', callback_data: 'answer:massage_type:Спина и шея' }],
  [{ text: 'Общий массаж', callback_data: 'answer:massage_type:Общий массаж' }],
  [
    {
      text: 'Не знаю — нужна консультация',
      callback_data: 'answer:massage_type:Нужна консультация',
    },
  ],
]);

export const exerciseFormats = inlineKeyboard([
  [{ text: 'Очно', callback_data: 'answer:exercise_format:Очно' }],
  [{ text: 'Онлайн', callback_data: 'answer:exercise_format:Онлайн' }],
  [{ text: 'Помогите выбрать', callback_data: 'answer:exercise_format:Нужна консультация' }],
]);

export function privacyKeyboard(policyUrl: string): InlineKeyboardMarkup {
  return inlineKeyboard([
    [{ text: 'Открыть Политику', url: policyUrl }],
    [{ text: '✅ Согласен(на)', callback_data: 'privacy:accept' }],
    [{ text: 'Не согласен(на)', callback_data: 'privacy:decline' }],
  ]);
}

export function subscriptionKeyboard(channelUrl: string, complex: number): InlineKeyboardMarkup {
  return inlineKeyboard([
    [{ text: 'Подписаться на канал', url: channelUrl }],
    [{ text: 'Проверить подписку', callback_data: `subscription:${complex}` }],
  ]);
}
