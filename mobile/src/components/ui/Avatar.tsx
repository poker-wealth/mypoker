import { Image, StyleSheet, Text, View } from 'react-native';
import { avatarVisual, UPLOADED_AVATAR, type AvatarRef } from '../../lib/avatars';
import { useApiBase } from '../../apiConfig';
import { theme, weight } from '../../theme';

interface AvatarProps {
  /** A curated id, the uploaded-photo sentinel, or null if they never picked one. */
  avatarId?: AvatarRef | string | null;
  /**
   * Required to render an uploaded photo (`avatarId === UPLOADED_AVATAR`): that
   * photo has no URL of its own, only `GET /avatars/:playerId`, so this needs
   * the id to build one. Omitting it while `avatarId` is the sentinel falls
   * through to the next step of the chain rather than rendering nothing.
   */
  playerId?: string | null;
  /** OAuth profile photo (Google/Telegram), or null if the account has none. */
  photoUrl?: string | null;
  /** Used for the initial fallback only. */
  name: string;
  size?: number;
}

/**
 * The one place that decides what a player's avatar looks like — the native
 * port of `frontend/src/components/ui/Avatar.tsx`.
 *
 * Fallback order, and it matters: a Google or Telegram player keeps their real
 * photo unless they deliberately pick from the catalogue or upload their own.
 *   1. Chosen avatarId (catalogue colour + glyph)
 *   2. Uploaded photo (avatarId === UPLOADED_AVATAR) — GET /avatars/:playerId,
 *      public and unauthenticated, same threat model as the curated tiles.
 *      Requires `playerId`.
 *   3. OAuth photoUrl
 *   4. The player's initial
 *
 * This did not exist on mobile at all. The avatar PICKER shipped first, which
 * meant a player could choose a picture that nothing in the app then displayed
 * — found by looking at My Account, not by any check. `check:parity` compares
 * routes and tabs, never screen CONTENTS, so it was blind to it (TRAPS §9: the
 * comparison has to be built by opening both files, and impression is not a
 * method).
 *
 * The web builds its tile from a CSS gradient; there is no gradient primitive
 * here without a dependency, so the tile is the catalogue's first colour with
 * the second as its ring. Same identity, expressed in what React Native has.
 */
export function Avatar({ avatarId, playerId, photoUrl, name, size = 64 }: AvatarProps) {
  const apiBase = useApiBase();
  const visual = avatarId ? avatarVisual(avatarId) : undefined;
  const box = { width: size, height: size, borderRadius: size / 2 };
  const initial = name.charAt(0).toUpperCase() || '?';

  if (visual) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.center,
          box,
          { backgroundColor: visual.colors[0], borderColor: visual.colors[1] },
        ]}
      >
        <Text style={{ fontSize: size * 0.5 }}>{visual.glyph}</Text>
      </View>
    );
  }

  // `apiBase` resolves asynchronously (SecureStore), so it is null on the first
  // render. Falling through to the initial for that one frame is deliberate —
  // the alternative is a broken image request to the string "null/avatars/…".
  if (avatarId === UPLOADED_AVATAR && playerId && apiBase) {
    return (
      <Image
        // No cache-busting param: the gateway serves this with a 5-minute
        // max-age precisely so a re-upload becomes visible on its own within a
        // few minutes. Every client inventing its own busting scheme on top of
        // that is how one of them ends up never showing a new photo at all.
        source={{ uri: `${apiBase}/avatars/${encodeURIComponent(playerId)}` }}
        style={[styles.photo, box]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={[styles.photo, box]}
        accessibilityIgnoresInvertColors
      />
    );
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.center, styles.initialTile, box]}
    >
      <Text style={[styles.initial, { fontSize: size * 0.4 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  photo: { resizeMode: 'cover' },
  initialTile: { backgroundColor: theme.brand, borderColor: theme.brand },
  initial: { color: theme.text, fontFamily: weight('800') },
});
