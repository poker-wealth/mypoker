/**
 * Nodemailer is stubbed so the tests exercise the real send path — claim,
 * send, record — without opening an SMTP connection. Everything under test
 * (dedupe, failure release, both body halves) lives above the transport.
 */
interface SentMail { to: string; subject: string; html: string; text: string }
const sent: SentMail[] = [];
let failNext = false;

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: {
    createTransport: () => ({
      sendMail: (mail: SentMail): Promise<void> => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error('smtp unavailable'));
        }
        sent.push(mail);
        return Promise.resolve();
      },
    }),
  },
}));

import { mailConfig, resetMailTransport, mailTransport } from '../../src/notifications/email/transport';
import {
  formatAmount,
  depositReceived,
  withdrawalRequested,
  withdrawalSent,
} from '../../src/notifications/email/templates';
import { sendEmail, EmailSendModel } from '../../src/notifications/email/send-email';
import { startTestDb, stopTestDb, clearCollections, ensureIndexes } from '../db-helper';

/**
 * [money-adjacent] The money receipts.
 *
 * These emails are a record a player keeps and may hold the platform to, so
 * the properties that matter are: the figure matches the ledger exactly, one
 * event can only ever produce one email, and nothing here can take down the
 * money path it hangs off.
 */

beforeAll(async () => {
  await startTestDb();
  await ensureIndexes(EmailSendModel);
});
afterAll(stopTestDb);
afterEach(async () => {
  await clearCollections();
  resetMailTransport();
});

describe('transport configuration', () => {
  it('is null when SMTP is incomplete, rather than half-built', () => {
    expect(mailConfig({ SMTP_HOST: 'smtp.hostinger.com' })).toBeNull();
    expect(mailConfig({ SMTP_HOST: 'h', SMTP_USER: 'u' })).toBeNull();
    expect(mailConfig({})).toBeNull();
  });

  it('reads a complete Hostinger config', () => {
    const cfg = mailConfig({
      SMTP_HOST: 'smtp.hostinger.com',
      SMTP_PORT: '465',
      SMTP_USER: 'no-reply@mypoker777.com',
      SMTP_PASS: 'secret',
      EMAIL_FROM: 'MYPOKER <no-reply@mypoker777.com>',
    });
    expect(cfg).toEqual({
      host: 'smtp.hostinger.com',
      port: 465,
      user: 'no-reply@mypoker777.com',
      pass: 'secret',
      from: 'MYPOKER <no-reply@mypoker777.com>',
    });
  });

  it('falls back to the mailbox address when EMAIL_FROM is missing', () => {
    // Mail with an empty sender is rejected by every provider, so a missing
    // EMAIL_FROM must not produce one.
    const cfg = mailConfig({
      SMTP_HOST: 'h',
      SMTP_USER: 'no-reply@mypoker777.com',
      SMTP_PASS: 'p',
    });
    expect(cfg!.from).toBe('no-reply@mypoker777.com');
  });

  it('returns no transport when unconfigured — not an error', () => {
    expect(mailTransport({})).toBeNull();
  });
});

describe('formatAmount — the ledger string, not a float', () => {
  it('renders the ledger decimal without arithmetic', () => {
    expect(formatAmount('20.000000')).toBe('20.00');
    expect(formatAmount('1234.500000')).toBe('1234.50');
    expect(formatAmount('0.010000')).toBe('0.01');
  });

  it('truncates rather than rounds', () => {
    // Rounding up would claim a cent the ledger never moved.
    expect(formatAmount('9.999999')).toBe('9.99');
  });

  it('survives a whole-number string', () => {
    expect(formatAmount('500')).toBe('500.00');
  });
});

describe('templates', () => {
  const at = new Date('2026-08-11T10:00:00Z');

  it('states the amount exactly, in subject, html and text', () => {
    const t = depositReceived({
      amount: '20.000000',
      txHash: 'abc123',
      network: 'TRC-20',
      at,
    });
    expect(t.subject).toBe('Deposit of $20.00 credited');
    expect(t.html).toContain('$20.00 received');
    expect(t.text).toContain('$20.00 received');
  });

  it('always carries a plain-text half', () => {
    // Some clients only take text, every client previews from it, and a
    // message without one scores as spam.
    for (const t of [
      depositReceived({ amount: '1.000000', txHash: 'h', network: 'TRC-20', at }),
      withdrawalRequested({ amount: '1.000000', address: 'TR7...', at }),
      withdrawalSent({ amount: '1.000000', address: 'TR7...', txHash: 'h', network: 'TRC-20', at }),
    ]) {
      expect(t.text.length).toBeGreaterThan(40);
      expect(t.text).toContain('Fair. On-Chain. Always.');
    }
  });

  it('uses table layout and inline styles, never app CSS', () => {
    const t = depositReceived({ amount: '5.000000', txHash: 'h', network: 'TRC-20', at });
    expect(t.html).toContain('<table');
    expect(t.html).toContain('style="');
    // Tailwind classes and <style> blocks do not survive Gmail or Outlook.
    expect(t.html).not.toContain('class="');
    expect(t.html).not.toContain('<style');
  });

  it('escapes interpolated values', () => {
    // Addresses and hashes are opaque strings from outside; one containing a
    // tag must not become markup in someone's inbox.
    const t = withdrawalSent({
      amount: '1.000000',
      address: '<img src=x onerror=alert(1)>',
      txHash: 'h',
      network: 'TRC-20',
      at,
    });
    expect(t.html).not.toContain('<img src=x');
    expect(t.html).toContain('&lt;img');
  });

  it('does not alarm on a withdrawal request', () => {
    const t = withdrawalRequested({ amount: '20.000000', address: 'TR7...', at });
    expect(t.html).not.toMatch(/pending review|on hold|frozen|problem/i);
  });
});

describe('sendEmail — the unconfigured path', () => {
  const template = depositReceived({
    amount: '20.000000',
    txHash: 'h',
    network: 'TRC-20',
    at: new Date(),
  });

  it('does nothing when the player has no address on file', async () => {
    // Telegram sign-in never asks for one. Ordinary, not an error.
    expect(await sendEmail(null, template, 'e-1')).toBe('no_recipient');
    expect(await EmailSendModel.countDocuments({})).toBe(0);
  });

  it('reports not_configured rather than throwing when SMTP is absent', async () => {
    // The deposit path calls this. A missing SMTP password must never be able
    // to fail a credit.
    expect(await sendEmail('p@example.com', template, 'e-2')).toBe('not_configured');
  });

  it('claims no event id when it cannot send', async () => {
    // The short-circuit happens BEFORE the claim on purpose: claiming an id
    // for a send that cannot happen would suppress the receipt permanently
    // once SMTP is finally configured.
    await sendEmail('p@example.com', template, 'e-3');
    expect(await EmailSendModel.countDocuments({ _id: 'e-3' })).toBe(0);
  });
});

describe('sendEmail — at most one email per event', () => {
  const template = depositReceived({
    amount: '20.000000',
    txHash: 'h',
    network: 'TRC-20',
    at: new Date(),
  });

  beforeEach(() => {
    sent.length = 0;
    process.env.SMTP_HOST = 'smtp.test';
    process.env.SMTP_PORT = '587';
    process.env.SMTP_USER = 'no-reply@mypoker777.com';
    process.env.SMTP_PASS = 'secret';
    process.env.EMAIL_FROM = 'MYPOKER <no-reply@mypoker777.com>';
    resetMailTransport();
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.EMAIL_FROM;
  });

  it('sends once and records it', async () => {
    expect(await sendEmail('p@example.com', template, 'e-10')).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe('p@example.com');
    expect(sent[0]!.subject).toBe('Deposit of $20.00 credited');
    // Both halves on the wire — the text part is not optional.
    expect(sent[0]!.html).toContain('$20.00');
    expect(sent[0]!.text).toContain('$20.00');

    const row = await EmailSendModel.findById('e-10').lean();
    expect(row?.sentAt).toBeInstanceOf(Date);
  });

  it('will not send the same event twice', async () => {
    expect(await sendEmail('p@example.com', template, 'e-11')).toBe('sent');
    expect(await sendEmail('p@example.com', template, 'e-11')).toBe('duplicate');
    // The retry is the normal case — a replayed queue message, a restart
    // mid-request. One receipt, not two.
    expect(sent).toHaveLength(1);
  });

  it('sends exactly one email when several workers race the same event', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () => sendEmail('p@example.com', template, 'e-12')),
    );
    // The unique _id in the database — not this process — is what enforces it.
    expect(sent).toHaveLength(1);
    expect(await EmailSendModel.countDocuments({ _id: 'e-12' })).toBe(1);
  });

  it('releases the claim when the mail server fails, so a retry can work', async () => {
    failNext = true;
    expect(await sendEmail('p@example.com', template, 'e-13')).toBe('failed');
    // A claimed-but-unsent row would suppress this receipt forever.
    expect(await EmailSendModel.countDocuments({ _id: 'e-13' })).toBe(0);

    expect(await sendEmail('p@example.com', template, 'e-13')).toBe('sent');
    expect(sent).toHaveLength(1);
  });

  it('never throws at the caller — the money path cannot be failed by mail', async () => {
    failNext = true;
    await expect(sendEmail('p@example.com', template, 'e-14')).resolves.toBe('failed');
  });
});
