/**
 * Table invites, as links that land somewhere useful — the native twin of
 * `frontend/src/lib/tableInvite.ts`.
 *
 * A plain `https://app.mypoker777.com/table/<id>` works, but sent in Telegram
 * it opens the phone's BROWSER: a fresh session with no sign-in, so the person
 * you invited meets a login screen instead of your table. The Telegram deep
 * link opens the Mini App as them, routed straight to the table.
 *
 * THE PACKING, identical to the web's because the Mini App parses what this
 * builds: `startapp` allows only `A-Za-z0-9_-` up to 64 characters, so the
 * table id and a private join code travel as one token separated by `__`.
 *
 * This lived inside `CreateTableSheet` as a private function, which meant the
 * table screen could not share a link without importing from a sheet. One
 * format, one place — a second copy is a second answer waiting to happen.
 */

/** The bot the Mini App lives behind. Mirrors the web's TELEGRAM_BOT_NAME. */
const TELEGRAM_BOT = process.env.EXPO_PUBLIC_TELEGRAM_BOT ?? 'mypoker777_bot';

/**
 * A registered Mini App short name, if the bot has one. EMPTY, like the web.
 *
 * The link was `t.me/<bot>/app?startapp=…` on both clients and every invite
 * answered 'Bot application not found': `app` is not a path, it is a short name
 * registered in BotFather, and no app is registered under it. Without it the
 * link opens the bot's main Mini App — the one that already works.
 */
const TELEGRAM_APP = process.env.EXPO_PUBLIC_TELEGRAM_APP ?? '';

/**
 * The link a creator shares.
 *
 * `joinCode` rides along for a PRIVATE table: such a table refuses anyone who
 * has not presented its code, so a link without it would be a link that does
 * not work. Omit it when sharing from inside a table — that is done by whoever
 * is sitting there, who may have been let in by a creator that did not intend
 * the code to travel further.
 */
export function inviteLinkFor(tableId: string, joinCode?: string | null): string {
  const token = joinCode ? `${tableId}__${joinCode}` : tableId;
  const path = TELEGRAM_APP ? `/${TELEGRAM_APP}` : '';
  return `https://t.me/${TELEGRAM_BOT}${path}?startapp=${token}`;
}
