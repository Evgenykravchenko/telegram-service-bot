import { describe, expect, it } from 'vitest';
import type { ApplicationRecord } from '../src/domain/types.js';
import { buildAdminCard } from '../src/services/application-worker.js';

describe('buildAdminCard', () => {
  it('renders a lead and escapes user input', () => {
    const application: ApplicationRecord = {
      id: 7,
      chatId: 10,
      userId: 20,
      user: { id: 20, first_name: 'Иван', username: 'client' },
      flow: 'massage',
      source: 'instagram_reels',
      data: {
        name: '<Иван>',
        phone: '+7 900 000-00-00',
        massage_type: 'Спина и шея',
        concern: 'Напряжение & усталость',
        preferred_time: 'вечером',
        preferred_days: 'суббота',
      },
      consentAt: '2026-09-13T10:00:00.000Z',
      status: 'delivering',
      attempts: 1,
    };
    const card = buildAdminCard(application);
    expect(card).toContain('&lt;Иван&gt;');
    expect(card).toContain('Напряжение &amp; усталость');
    expect(card).toContain('@client');
    expect(card).toContain('instagram_reels');
  });
});
