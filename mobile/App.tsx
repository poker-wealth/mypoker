// Must be first: @noble needs a CSPRNG, and React Native has none until this shim installs one.
// Without it, key generation throws at the first handshake.
import 'react-native-get-random-values';

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { TableScreen } from './src/screens/TableScreen';

/**
 * FairPlay, on the phone.
 *
 * ESTHER_V2 task 6: the same games, natively on iOS and Android, at parity with the web app and the
 * Telegram Mini App. This is the game/table half — the live-table transport and the felts. The
 * shell, wallet, auth and store submission are Samuel's.
 *
 * Navigation is deliberately two screens and a piece of state for now, not a router. There is one
 * route that matters until the felts land, and wiring a navigator around it would be scaffolding
 * built before the thing it holds.
 */

interface OpenTable {
  tableId: string;
  name: string;
}

export default function App() {
  const [table, setTable] = useState<OpenTable | null>(null);

  /**
   * No session yet — auth is Samuel's half. The table screen says so plainly rather than opening a
   * socket that will be refused, and a token dropped in here lights the whole path up.
   */
  const token: string | null = null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.app} edges={['top', 'bottom']}>
        <StatusBar style="light" />

        <View style={styles.header}>
          {table ? (
            <Pressable onPress={() => setTable(null)} hitSlop={12}>
              <Text style={styles.back}>‹ tables</Text>
            </Pressable>
          ) : (
            <Text style={styles.brand}>FAIRPLAY</Text>
          )}
          {table && <Text style={styles.title}>{table.name}</Text>}
        </View>

        {table ? (
          <TableScreen tableId={table.tableId} token={token} />
        ) : (
          <LobbyScreen onOpenTable={(tableId, name) => setTable({ tableId, name })} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#0b0b17' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#242445',
  },
  brand: { color: '#f5c451', fontWeight: '900', letterSpacing: 2 },
  back: { color: '#8b8bb0', fontSize: 15 },
  title: { color: '#fff', fontWeight: '700' },
});
