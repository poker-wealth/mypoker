import {
  GameSocketServer,
  type ClientContext,
  type GameSocketServerConfig,
} from '../transport/ws-server';
import type { Inbound } from '../transport/protocol';
import { PokerRoom, type PokerRoomConfig, type PokerRoomDeps } from './poker-room';
import { tableCommandSchema, type TableSummary } from './room-state';

/**
 * Turn the token on the WebSocket handshake into a player id.
 *
 * The table asks nothing else of authentication. In practice this wraps the gateway's
 * `verifyToken` (`src/gateway/tokens.ts`), so a socket is trusted on exactly the same JWT the REST
 * API trusts — one sign-in, one identity, both surfaces.
 */
export type TokenVerifier = (token: string) => { playerId: string };

/**
 * TableHub — the live tables and the socket in front of them.
 *
 * It owns the room list and translates the transport's three verbs (`join` / `action` / `leave`)
 * into room calls. The security layer underneath is untouched: `GameSocketServer` still does the
 * ECDH handshake, HMAC-per-message and rate limiting, and hands us a connection that already knows
 * which player it is. Everything above that seam is poker.
 */
export class TableHub {
  private readonly rooms = new Map<string, PokerRoom>();
  /** Per connection, per room: how to stop sending it snapshots. */
  private readonly subscriptions = new Map<ClientContext, Map<string, () => void>>();
  private readonly socket: GameSocketServer;

  constructor(
    private readonly deps: PokerRoomDeps,
    verifyToken: TokenVerifier,
    /** Optional connection log — see `GameSocketServerConfig.onEvent`. */
    onEvent?: GameSocketServerConfig['onEvent'],
  ) {
    this.socket = new GameSocketServer({
      verifyToken,
      onInbound: (ctx, msg): Promise<void> => this.onInbound(ctx, msg),
      onClose: (ctx): void => this.onClose(ctx),
      ...(onEvent ? { onEvent } : {}),
    });
  }

  /** Open a table. Returns the room so callers can inspect it in tests. */
  addTable(config: PokerRoomConfig): PokerRoom {
    if (this.rooms.has(config.id)) throw new Error(`table already exists: ${config.id}`);
    const room = new PokerRoom(config, this.deps);
    this.rooms.set(config.id, room);
    return room;
  }

  room(tableId: string): PokerRoom | undefined {
    return this.rooms.get(tableId);
  }

  tables(): TableSummary[] {
    return [...this.rooms.values()].map((room) => room.summary());
  }

  /** Start the WebSocket listener on its own port. */
  listen(port = 0): Promise<number> {
    return this.socket.listen(port);
  }

  /** Share an HTTP server's port with the REST API (what the app server does). */
  attachTo(server: Parameters<GameSocketServer['attachTo']>[0], path?: string): void {
    this.socket.attachTo(server, path);
  }

  async close(): Promise<void> {
    await this.socket.close();
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.subscriptions.clear();
  }

  // ── Transport → room ────────────────────────────────────────────────────────

  private async onInbound(ctx: ClientContext, msg: Inbound): Promise<void> {
    const room = this.rooms.get(msg.roomId);
    if (!room) return ctx.send({ type: 'error', message: `unknown table: ${msg.roomId}` });
    const playerId = ctx.session.playerId;

    switch (msg.type) {
      case 'join': {
        this.unsubscribe(ctx, msg.roomId); // re-joining resyncs rather than double-subscribing
        const stop = room.join(playerId, (snapshot) => {
          ctx.send({ type: 'state', roomId: msg.roomId, state: snapshot });
        });
        let byRoom = this.subscriptions.get(ctx);
        if (!byRoom) {
          byRoom = new Map();
          this.subscriptions.set(ctx, byRoom);
        }
        byRoom.set(msg.roomId, stop);
        return;
      }
      case 'leave':
        this.unsubscribe(ctx, msg.roomId);
        return;
      case 'action': {
        const parsed = tableCommandSchema.safeParse(msg.action);
        if (!parsed.success) {
          return ctx.send({ type: 'error', message: 'bad table command' });
        }
        try {
          await room.command(playerId, parsed.data);
        } catch (err) {
          // Illegal moves are ordinary — tell this player why and leave the table running.
          ctx.send({ type: 'error', message: err instanceof Error ? err.message : 'rejected' });
        }
        return;
      }
      default:
        return;
    }
  }

  private onClose(ctx: ClientContext): void {
    const byRoom = this.subscriptions.get(ctx);
    if (!byRoom) return;
    for (const stop of byRoom.values()) stop();
    this.subscriptions.delete(ctx);
  }

  private unsubscribe(ctx: ClientContext, roomId: string): void {
    const byRoom = this.subscriptions.get(ctx);
    const stop = byRoom?.get(roomId);
    if (stop) {
      stop();
      byRoom!.delete(roomId);
    }
  }
}
