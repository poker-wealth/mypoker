import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TableScreenProps } from '../navigation';
import { API_URL } from '../api';
import { getToken } from '../session';
import { radius, space, theme } from '../theme';

/**
 * TableScreen — THE SEAM. A stub, deliberately.
 *
 * The shell's job ends here: it has decided which table and it can prove who
 * you are. Everything below this line — connecting, the handshake, the felt,
 * betting — belongs to the game side (ESTHER_V2 task 6), which is why this file
 * opens no socket and renders no cards.
 *
 * It exists so that work does not start by wiring navigation, which is the
 * shell's half. Replace the placeholder below; leave the wiring alone.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHAT THE WEB CLIENT DOES, AS THE REFERENCE
 *
 *   new TableSocket(url, token, tableId, {
 *     onSnapshot, onStatus, onError, onUnauthorized?
 *   })                                  frontend/src/api/tableSocket.ts:70-75
 *
 * It auto-sends `{ type: 'join', roomId }` once the handshake completes, then
 * seating is a separate command: `{ kind: 'sit', seat, buyIn }`.
 *
 * Wire types (TableSnapshot, TableCommand, LiveSeat) are in
 * `frontend/src/lib/liveTable.ts`, mirroring `game-server/src/live/room-state.ts`.
 * The socket URL is the gateway with the scheme swapped: http -> ws, plus `/ws`.
 *
 * WHAT REACT NATIVE DOES NOT GIVE YOU
 *
 *   crypto.subtle   — the whole X25519/HKDF/HMAC path needs a native provider.
 *                     See mobile/CLAUDE.md for the exact parameters and the
 *                     SPKI-vs-raw-32-bytes trap.
 *   btoa / atob     — used for base64 on the wire; shim or swap.
 *   localStorage    — the client seed lives there on web
 *                     (frontend/src/lib/clientSeed.ts:11). SecureStore or
 *                     AsyncStorage here; it is not a secret, just per-device.
 *   window.setTimeout handle types — RN returns a different handle type.
 *
 * RN DOES provide `WebSocket` and `fetch`, so the transport shape carries over.
 * ─────────────────────────────────────────────────────────────────────────
 */
export function TableScreen({ route }: TableScreenProps) {
  const { tableId } = route.params;
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    let alive = true;
    // The shell owns the token; the game side asks for it and never stores its
    // own copy. Two copies drift, and the one that drifts fails mid-hand.
    void getToken().then((t) => {
      if (alive) setHasToken(t !== null);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Table</Text>

      <View style={styles.card}>
        <Row label="tableId" value={tableId} mono />
        <Row label="gateway" value={API_URL || 'EXPO_PUBLIC_API_URL not set'} mono />
        <Row
          label="session"
          value={
            hasToken === null ? 'checking…' : hasToken ? 'token available' : 'signed out'
          }
        />
      </View>

      <Text style={styles.note}>
        The shell stops here. The socket, the handshake and the felt are the game side&apos;s —
        see the handoff notes at the top of this file.
      </Text>
    </ScrollView>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, mono && styles.mono]} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg, gap: space.md },
  heading: { color: theme.text, fontSize: 20, fontWeight: '800' },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.md,
    gap: space.sm,
  },
  row: { gap: 2 },
  rowLabel: {
    color: theme.dim,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  rowValue: { color: theme.text, fontSize: 13 },
  mono: { fontFamily: 'monospace' },
  note: { color: theme.dim, fontSize: 12, lineHeight: 18 },
});
