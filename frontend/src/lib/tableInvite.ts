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
 */
export function inviteUrl(invite: TableInvite, botName: string): string {
  return `https://t.me/${botName}/app?startapp=${encodeInvite(invite)}`;
}
