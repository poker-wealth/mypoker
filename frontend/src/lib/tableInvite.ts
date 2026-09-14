/**
 * Table invites, as links that land somewhere useful.
 *
 * A plain `https://app.mypoker777.com/table/<id>` works, but sent in Telegram
 * it opens the phone's BROWSER — a fresh session with no sign-in, so the
 * person you invited meets a login screen instead of your table. The Telegram
 * deep link opens the Mini App instead: already authenticated as them, and
 * routed straight to the table.
 *
 * THE PACKING. Telegram's `startapp` allows only `A-Za-z0-9_-`, up to 64
 * characters, so the table id and the private join code travel as one token
 * separated by `__` (two underscores — a single one is legal inside neither
 * half, but two cannot appear by accident since ids are hex and codes are
 * digits). `t-9f6742590c87__418208` is 21 characters, well inside the limit.
 *
 * Kept in one file because BOTH clients build these and the Mini App parses
 * them; a second copy of the format is a second answer waiting to happen.
 */

/** Matches the ids the server mints: `t-<hex>` and league `lg-<id>-<hex>`. */
const TABLE_TOKEN = /^(?:t-[0-9a-f]{8,}|lg-.+-[0-9a-f]{8})$/;

export interface TableInvite {
  tableId: string;
  /** Private tables only; absent for public ones. */
  code?: string;
}

/** Pack an invite into a Telegram `startapp` token. */
export function encodeInvite(invite: TableInvite): string {
  return invite.code ? `${invite.tableId}__${invite.code}` : invite.tableId;
}

/**
 * Read a `startapp` token back, or null if it is not a table invite at all —
 * the same parameter carries referral ids, so anything unrecognised must fall
 * through untouched rather than being forced into a table route.
 */
export function decodeInvite(param: string | null | undefined): TableInvite | null {
  if (!param) return null;
  const [tableId, code] = param.split('__');
  if (!tableId || !TABLE_TOKEN.test(tableId)) return null;
  return code ? { tableId, code } : { tableId };
}

/** The path the Mini App should open for an invite. */
export function invitePath(invite: TableInvite): string {
  return `/table/${invite.tableId}${invite.code ? `?code=${invite.code}` : ''}`;
}

/**
 * The link a creator actually shares.
 *
 * Deliberately NOT `window.location.origin` + the path, which is what this
 * used to be: that produced a web URL, and a web URL opened in Telegram
 * launches the phone's browser — a fresh session, so the friend you invited
 * meets a sign-in page instead of your table. This opens the Mini App as
 * them, routed to the table by the token above.
 *
 * NO `/app` SEGMENT. It used to be `t.me/<bot>/app?startapp=…`, and every link
 * anyone shared answered **"Bot application not found"** — reported 12 Sep 2026
 * with a real link that did it. That path segment is not the word "app": it is
 * the SHORT NAME of a Mini App registered against the bot in BotFather, and
 * this bot has none by that name. Telegram looked up an app called `app`, found
 * nothing, and said so.
 *
 * `t.me/<bot>?startapp=<token>` opens the bot's MAIN Mini App instead — the one
 * configured on the bot itself, which is the one players already open from the
 * chat, so it is known to exist. The token arrives the same way (`start_param`,
 * see AppShell) and routing is unchanged.
 *
 * If a named Mini App is ever registered, set `VITE_TELEGRAM_APP_NAME` and the
 * named form comes back. It is deliberately EMPTY by default: a wrong short
 * name here does not degrade, it breaks every invite in the product.
 */
/**
 * Read an invite out of whatever a player actually pastes.
 *
 * WHY THIS EXISTS. A deep link only opens the app if the bot has a Mini App
 * registered in BotFather, and on 12 Sep 2026 this one had none at all
 * (`getMe` → `has_main_web_app: false`), so every shared link answered
 * "Bot application not found" and then BOT_INVALID. That is a switch only the
 * bot's owner can throw, and until they do, an invited player is holding a
 * link nothing will open. This gives them a way in that depends on no Telegram
 * configuration whatsoever: paste it, and the app reads the table out of it.
 *
 * ACCEPTS, in order of what people actually have in their clipboard:
 *   - a Telegram deep link, either form, `?startapp=<token>`
 *   - a web URL, `…/table/<id>?code=<code>`
 *   - the bare token a link carries, `t-abc123__4821`
 *   - the table id on its own
 *
 * Returns null for anything that does not contain a table id in a shape the
 * server would recognise — better to say "that isn't a table link" than to
 * navigate to a table that cannot exist.
 */
export function parseInviteInput(raw: string): TableInvite | null {
  const text = raw.trim();
  if (!text) return null;

  // Both link shapes carry the whole invite in one query parameter.
  const startapp = /[?&]startapp=([A-Za-z0-9_-]+)/.exec(text);
  if (startapp) return decodeInvite(startapp[1]);

  // A web URL: the id is a path segment and the code its own parameter.
  const path = /\/table\/([A-Za-z0-9_-]+)/.exec(text);
  if (path?.[1] && TABLE_TOKEN.test(path[1])) {
    const code = /[?&]code=([A-Za-z0-9_-]+)/.exec(text);
    return code?.[1] ? { tableId: path[1], code: code[1] } : { tableId: path[1] };
  }

  // A bare token, or a bare id — the same thing `decodeInvite` reads, which is
  // also what someone gets if they copy only part of a link.
  return decodeInvite(text);
}

export function inviteUrl(invite: TableInvite, botName: string, appName = ''): string {
  const path = appName ? `/${appName}` : '';
  return `https://t.me/${botName}${path}?startapp=${encodeInvite(invite)}`;
}
