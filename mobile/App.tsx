import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';
import { WalletScreen } from './src/screens/WalletScreen';
import { TableScreen } from './src/screens/TableScreen';
import type { RootStackParamList } from './src/navigation';
import { API_URL } from './src/api';
import { space, theme } from './src/theme';

/**
 * The app shell (SAMUEL_V2 task 8).
 *
 * Owns navigation, session and the API client. The game side — felts and the
 * live-table socket — plugs in here; the seam between us is the session token
 * and a tableId, nothing more.
 *
 * Deliberately thin at this stage. It exists so there is somewhere for both
 * halves to land and so the Bare Workflow gate can be proven on hardware, not
 * because a two-tab app is the goal.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone changes networks constantly; one retry absorbs a handover,
      // more just delays telling the user something is wrong.
      retry: 1,
      staleTime: 10_000,
    },
  },
});

const Tabs = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

const navTheme: Theme = {
  dark: true,
  colors: {
    primary: theme.brand,
    background: theme.bg,
    card: theme.surface,
    text: theme.text,
    border: theme.border,
    notification: theme.danger,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' },
    medium: { fontFamily: 'System', fontWeight: '500' },
    bold: { fontFamily: 'System', fontWeight: '700' },
    heavy: { fontFamily: 'System', fontWeight: '900' },
  },
};

/**
 * Placeholder for a screen that has not been ported yet.
 *
 * It says so plainly rather than showing an empty tab or invented content — the
 * same honesty rule the Mini App follows. A blank screen reads as broken; this
 * reads as unfinished, which is what it is.
 */
function NotPortedYet({ name }: { name: string }) {
  return (
    <View style={styles.placeholder}>
      <Text style={styles.placeholderTitle}>{name}</Text>
      <Text style={styles.placeholderBody}>
        Not ported to the app yet. It is live in the Telegram Mini App.
      </Text>
    </View>
  );
}

function TabsScreen() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: theme.bg },
        headerTitleStyle: { color: theme.text },
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        tabBarActiveTintColor: theme.brand,
        tabBarInactiveTintColor: theme.dim,
      }}
    >
      <Tabs.Screen name="Wallet" component={WalletScreen} />
      <Tabs.Screen name="Tables">{() => <NotPortedYet name="Tables" />}</Tabs.Screen>
      <Tabs.Screen name="Account">{() => <NotPortedYet name="Account" />}</Tabs.Screen>
    </Tabs.Navigator>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <NavigationContainer theme={navTheme}>
        <StatusBar style="light" />
        {/* A stack over the tabs, so a table opens WITH a tableId rather than
            being a tab that has to guess which table you meant. That param is
            half the seam with the game side; see src/navigation.ts. */}
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: theme.bg },
            headerTitleStyle: { color: theme.text },
            headerTintColor: theme.text,
            contentStyle: { backgroundColor: theme.bg },
          }}
        >
          <Stack.Screen name="Tabs" component={TabsScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Table" component={TableScreen} />
        </Stack.Navigator>

        {/* Which gateway this build points at. Invisible in production, and the
            first question worth answering when a device "cannot load anything" —
            on an Android emulator the host is 10.0.2.2, never localhost. */}
        {__DEV__ && (
          <Text style={styles.devBanner}>{API_URL || 'EXPO_PUBLIC_API_URL is not set'}</Text>
        )}
      </NavigationContainer>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.xl,
    gap: space.sm,
  },
  placeholderTitle: { color: theme.text, fontSize: 18, fontWeight: '800' },
  placeholderBody: { color: theme.dim, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  devBanner: {
    color: theme.dim,
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: space.xs,
    backgroundColor: theme.bg,
  },
});
