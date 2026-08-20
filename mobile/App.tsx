// Must be first: @noble needs a CSPRNG, and React Native has none until this shim installs one.
// Without it, key generation throws at the first handshake.
import 'react-native-get-random-values';

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { colors, MAX_CONTENT_WIDTH } from './src/theme';
import { NavProvider, useNav } from './src/navigation';
import { Header } from './src/components/Header';
import { BottomNav } from './src/components/BottomNav';
import { GamesScreen } from './src/screens/GamesScreen';
import { TableScreen } from './src/screens/TableScreen';
import {
  AllianceScreen,
  DataScreen,
  LobbyScreen,
  ProfileScreen,
} from './src/screens/PlaceholderScreens';

/**
 * FairPlay, on the phone.
 *
 * ESTHER_V2 task 6: the same product natively on iOS and Android, at parity with the web app and
 * the Telegram Mini App. The arrangement here is the Mini App's — a route-titled header, the screen
 * below it, and five tabs pinned to the bottom in the owner-specified order (Alliance, Games,
 * Lobby, Data, Account), with Wallet hanging off My Account rather than taking a tab.
 *
 * A table opens OVER the tabs and takes the whole screen, exactly as `/table/:id` does on web.
 *
 * The seam with the app shell: Samuel owns the API client, the token/session store and navigation;
 * this covers the socket and the felts. The shell here is a placeholder so the game side is
 * testable — the screens only ever call `useNav()`, so replacing it is a small job.
 */

const token: string | null = null;

function Shell() {
  const { tab, table, closeTable } = useNav();

  if (table) {
    return (
      <View style={styles.fill}>
        <View style={styles.tableHeader}>
          <Pressable onPress={closeTable} hitSlop={12} style={styles.back}>
            <Ionicons name="chevron-back" size={20} color={colors.dim} />
            <Text style={styles.backText}>Games</Text>
          </Pressable>
          <Text style={styles.tableTitle} numberOfLines={1}>
            {table.name}
          </Text>
        </View>
        <TableScreen tableId={table.tableId} token={token} />
      </View>
    );
  }

  return (
    <View style={styles.fill}>
      <Header tab={tab} />
      <View style={styles.fill}>
        {tab === 'lobby' && <LobbyScreen />}
        {tab === 'games' && <GamesScreen />}
        {tab === 'alliance' && <AllianceScreen />}
        {tab === 'data' && <DataScreen />}
        {tab === 'profile' && <ProfileScreen />}
      </View>
      <BottomNav />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.app} edges={['top', 'bottom']}>
        <StatusBar style="light" />
        {/* The Mini App caps its content at 520px and centres it; phones are narrower, tablets
            are not, and an unbounded layout looks wrong on the latter. */}
        <View style={styles.centred}>
          <NavProvider>
            <Shell />
          </NavProvider>
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: colors.bg },
  centred: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  fill: { flex: 1 },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  back: { flexDirection: 'row', alignItems: 'center' },
  backText: { color: colors.dim, fontSize: 15 },
  tableTitle: { color: colors.text, fontWeight: '700', flex: 1 },
});
