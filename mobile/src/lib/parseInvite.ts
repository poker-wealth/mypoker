/**
 * Read a table invite out of whatever a player pastes — the native twin of
 * `parseInviteInput` in `frontend/src/lib/tableInvite.ts`.
 *
 * WHY THIS EXISTS. A Telegram deep link only opens the Mini App if the bot has
 * a Mini App registered in BotFather, and on 12 Sep 2026 this bot had none
 * (`getMe` → `has_main_web_app: false`), so every invite anyone shared was a
 * dead link. That switch is the bot owner's to throw and no code can do it, so
 * both clients let a player paste the link in and get to the table anyway.
 *
 * The formats are the ones people actually have in a clipboard: a Telegram
 * link either way round, a web URL, the bare token, or the table id alone.
 */

/** The ids the server mints: `t-<hex>`, and league tables `lg-<id>-<hex>`. */
const TABLE_TOKEN = /^(?:t-[0-9a-f]{8,}|lg-.+-[0-9a-f]{8})$/;

export interface TableInvite {
  tableId: string;
  /** Private tables only. */
  code?: string;
}

/** Split a `startapp` token — `<tableId>__<code>` — or null if it is not one. */
function fromToken(param: string | null | undefined): TableInvite | null {
  if (!param) return null;
  const [tableId, code] = param.split('__');
  if (!tableId || !TABLE_TOKEN.test(tableId)) return null;
  return code ? { tableId, code } : { tableId };
}

export function parseInviteInput(raw: string): TableInvite | null {
  const text = raw.trim();
  if (!text) return null;

  const startapp = /[?&]startapp=([A-Za-z0-9_-]+)/.exec(text);
  if (startapp) return fromToken(startapp[1]);

  const path = /\/table\/([A-Za-z0-9_-]+)/.exec(text);
  if (path?.[1] && TABLE_TOKEN.test(path[1])) {
    const code = /[?&]code=([A-Za-z0-9_-]+)/.exec(text);
    return code?.[1] ? { tableId: path[1], code: code[1] } : { tableId: path[1] };
  }

  return fromToken(text);
}
