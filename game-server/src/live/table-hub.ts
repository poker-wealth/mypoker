import {
  GameSocketServer,
  type ClientContext,
  type GameSocketServerConfig,
} from '../transport/ws-server';
import type { Inbound } from '../transport/protocol';
import './rooms'; // side effect: registers every game's room implementation
import { createRoom, type LiveRoom, type LiveTableConfig, type RoomDeps } from './live-room';
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
  private readonly rooms = new Map<string, LiveRoom>();
  /** Per connection, per room: how to stop sending it snapshots. */
  private readonly subscriptions = new Map<ClientContext, Map<string, () => void>>();
  private readonly socket: GameSocketServer;

  constructor(
    private readonly deps: RoomDeps,
    verifyToken: TokenVerifier,
    /** Optional connection log — see `GameSocketServerConfig.onEvent`. */
    onEvent?: GameSocketServerConfig['onEvent'],
    /** Whether a player may hold a socket — see `GameSocketServerConfig.authorizeSession`. */
    authorizeSession?: GameSocketServerConfig['authorizeSession'],
  ) {
    this.socket = new GameSocketServer({
      verifyToken,
      onInbound: (ctx, msg): Promise<void> => this.onInbound(ctx, msg),
      onClose: (ctx): void => this.onClose(ctx),
      ...(onEvent ? { onEvent } : {}),
      ...(authorizeSession ? { authorizeSession } : {}),
    });
  }

  /**
   * Remove a player from the felt right now: stand them up, then drop their
   * sockets.
   *
   * The handshake gate only stops the NEXT connection. A player already seated
   * when the ban lands keeps their socket, and with it their seat and their
   * turn — so a suspension applied mid-session did nothing until they happened
   * to reconnect. Called by the admin suspend route.
   *
   * Order matters. Standing up first releases the seat through the room's own
   * path — chips returned, §8.1 freed — so a later reconnect is not refused at
   * every table by a seat nobody is sitting in. Closing the socket first would
   * leave that seat held by a connection that no longer exists.
   *
   * Returns what it did, so the route can say so rather than claim it.
   */
  async evict(playerId: string, reason = 'suspended'): Promise<{ stoodUp: boolean; socketsClosed: number }> {
    let stoodUp = false;
    for (const room of this.rooms.values()) {
      if (!room.hasSeated(playerId)) continue;
      try {
        await room.command(playerId, { kind: 'stand' });
        stoodUp = true;
      } catch (err) {
        // A room that refuses the stand (mid-hand rules, say) must not stop the
        // socket from closing — the point is to get them off the felt.
        console.error(`[evict] ${playerId} could not stand at ${room.summary().tableId}:`, err);
      }
    }

    let socketsClosed = 0;
    for (const ctx of [...this.subscriptions.keys()]) {
      if (ctx.session.playerId !== playerId) continue;
      ctx.close(reason);
      socketsClosed += 1;
    }
    return { stoodUp, socketsClosed };
  }

  /** Open a table. The `game` on the config selects which room implementation runs it. The config
   *  is the full per-game config (poker blinds, etc.); the factory for that game reads its own fields. */
  addTable<C extends LiveTableConfig>(config: C): LiveRoom {
    if (this.rooms.has(config.id)) throw new Error(`table already exists: ${config.id}`);
    const room = createRoom(config, this.deps);
    this.rooms.set(config.id, room);
    return room;
  }

  room(tableId: string): LiveRoom | undefined {
    return this.rooms.get(tableId);
  }

  tables(): TableSummary[] {
    return [...this.rooms.values()].map((room) => room.summary());
  }

  /**
   * The table this player is seated at, or null.
   *
   * The hub is the only party that can answer this — a room can vouch for its
   * own seats and nothing else. Two callers need it and they must agree:
   * the sit refusal below, which has to NAME the table it is talking about,
   * and the lobby, which marks the row so the player does not have to
   * remember. One account can be seated at one table (§8.1), so this returns
   * at most one.
   */
  seatedAt(playerId: string): { tableId: string; name: string } | null {
    for (const room of this.rooms.values()) {
      if (room.hasSeated(playerId)) {
        const s = room.summary();
        return { tableId: s.tableId, name: s.name };
      }
    }
    return null;
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
        // Warm this player's real balance before they can sit. The buy-in pre-check reads the
        // directory synchronously; priming on join means it is fresh by sit-time. No-op for the
        // in-memory dev directory.
        void this.deps.directory.prime?.(playerId);
        let stop: () => void;
        try {
          stop = room.join(playerId, {
            sendSnapshot: (snapshot) =>
              ctx.send({ type: 'state', roomId: msg.roomId, state: snapshot }),
            sendEvent: (event, data) =>
              ctx.send({ type: 'event', roomId: msg.roomId, event, data }),
          });
        } catch (err) {
          // The spectator cap. A refused watcher gets told why, not a silent
          // socket with no snapshots.
          return ctx.send({
            type: 'error',
            message: err instanceof Error ? err.message : 'cannot watch this table',
          });
        }
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
        // §8.1 — one account, one table. Enforced HERE because the hub is the
        // only party that can see every room; a room can only vouch for its
        // own seats. Watching other tables stays allowed — the rule is about
        // playing several at once, which is the classic multi-boxing tell the
        // anti-bot section exists to prevent.
        if (parsed.data.kind === 'sit') {
          const elsewhere = this.seatedAt(playerId);
          if (elsewhere && elsewhere.tableId !== room.summary().tableId) {
            // NAME THE TABLE. This used to read "stand up at your other table
            // first" and stop there — true, and useless against thirteen
            // tables when you cannot remember which one you sat at. The rule
            // is right; being told which table to go to is what turns a wall
            // into a direction.
            return ctx.send({
              type: 'error',
              message: `one table at a time — stand up at ${elsewhere.name} first`,
            });
          }
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
