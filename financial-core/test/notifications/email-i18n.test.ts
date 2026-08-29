import {
  formatAmount,
  depositReceived,
  withdrawalRequested,
  withdrawalSent,
} from '../../src/notifications/email/templates';
import { LOCALES, MESSAGES, resolveLocale, type Locale } from '../../src/notifications/email/messages';

/**
 * [money-adjacent] The receipts, in the player's language.
 *
 * Pure functions — no database, no SMTP. What matters here is that a receipt
 * says the same NUMBER in every language and says it once: the amount is the
 * thing a player holds the platform to, and the currency mark is the thing that
 * has been rendered twice three times already (docs/TRAPS.md #4).
 */

const AT = new Date('2026-08-11T10:00:00Z');

const everyTemplate = (locale: Locale) => [
  depositReceived({ amount: '20.000000', txHash: 'abc123', network: 'TRC-20', at: AT, locale }),
  withdrawalRequested({ amount: '20.000000', address: 'TR7NHq', at: AT, locale }),
  withdrawalSent({
    amount: '20.000000',
    address: 'TR7NHq',
    txHash: 'abc123',
    network: 'TRC-20',
    at: AT,
    locale,
  }),
];

describe('resolveLocale', () => {
  it('takes the primary subtag, so regional variants still land somewhere', () => {
    expect(resolveLocale('zh-CN')).toBe('zh');
    expect(resolveLocale('zh-TW')).toBe('zh');
    expect(resolveLocale('en-GB')).toBe('en');
    expect(resolveLocale('pt_BR')).toBe('en'); // no Portuguese shipped — English, not a throw
  });

  it('falls back to English rather than failing', () => {
    // A player whose language we cannot place still gets their receipt.
    expect(resolveLocale(null)).toBe('en');
    expect(resolveLocale(undefined)).toBe('en');
    expect(resolveLocale('')).toBe('en');
    expect(resolveLocale('klingon')).toBe('en');
  });
});

describe('formatAmount', () => {
  it('returns digits only — the mark belongs to the phrase', () => {
    expect(formatAmount('20.000000')).toBe('20.00');
    expect(formatAmount('500')).toBe('500.00');
  });

  it('truncates rather than rounds', () => {
    // Rounding up would claim a cent the ledger never moved.
    expect(formatAmount('9.999999')).toBe('9.99');
  });
});

describe('every locale renders a complete receipt', () => {
  // The analogue of the frontend's check:locales. A missing key here does not
  // throw, it emails somebody a blank line where the amount should be.
  it.each(LOCALES)('%s states the amount exactly once, with one currency mark', (locale) => {
    for (const t of everyTemplate(locale)) {
      for (const part of [t.subject, t.html, t.text]) {
        expect(part).toContain('$20.00');
        // The mark, never doubled — TRAPS #4. `$$20.00` is what a formatter
        // adding a symbol to a string that already carries one produces.
        expect(part).not.toContain('$$');
      }
      // An unreplaced placeholder is worse than a wrong translation: it is
      // visibly broken in a message about someone's money.
      expect(t.subject).not.toMatch(/\{\{/);
      expect(t.text).not.toMatch(/\{\{/);
    }
  });

  it.each(LOCALES)('%s carries no leftover English in its headings', (locale) => {
    if (locale === 'en') return;
    const m = MESSAGES[locale];
    expect(m.deposit.heading).not.toBe(MESSAGES.en.deposit.heading);
    expect(m.withdrawalRequested.heading).not.toBe(MESSAGES.en.withdrawalRequested.heading);
    expect(m.withdrawalSent.heading).not.toBe(MESSAGES.en.withdrawalSent.heading);
  });
});

describe('the language actually changes the message', () => {
  it('renders a Chinese receipt for a zh player', () => {
    const t = depositReceived({
      amount: '20.000000',
      txHash: 'abc123',
      network: 'TRC-20',
      at: AT,
      locale: 'zh',
    });
    expect(t.subject).toBe('充值 $20.00 已到账');
    expect(t.html).toContain('充值已到账');
    // …and none of the English it replaced.
    expect(t.subject).not.toContain('Deposit');
  });

  it('defaults to English when no locale is given', () => {
    // Existing callers that pass no locale must keep working unchanged.
    const t = depositReceived({ amount: '20.000000', txHash: 'a', network: 'TRC-20', at: AT });
    expect(t.subject).toBe('Deposit of $20.00 credited');
  });
});
