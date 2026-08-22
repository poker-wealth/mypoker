import { NavigationContainer, type Theme } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WalletScreen } from './src/screens/WalletScreen';
import { TableScreen } from './src/screens/TableScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { AllianceScreen } from './src/screens/AllianceScreen';
import { DataScreen } from './src/screens/DataScreen';
import { LobbyScreen } from './src/screens/LobbyScreen';
import { GamesScreen } from './src/screens/GamesScreen';
import { VipScreen } from './src/screens/VipScreen';
import { NotificationsScreen } from './src/screens/NotificationsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { AgentCenterScreen } from './src/screens/AgentCenterScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { AuthProvider, useAuth } from './src/auth';
import type { RootStackParamList } from './src/navigation';
import { useApiBase } from './src/apiConfig';
import { space, theme } from './src/theme';
import { AccountIcon, AllianceIcon, DataIcon, GamesIcon, LobbyIcon } from './src/icons';
// Side-effect import: initialises i18next before any screen calls
// useTranslation(). Nothing pulled this in until now — WalletScreen and
// TableScreen predate it and hardcode their copy in English.
import './src/i18n';

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

function TabsScreen() {
  const { t } = useTranslation();
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
      {/* The Mini App's own five, in its own order: Alliance, Games, Lobby, Data, My Account
          (frontend/src/components/BottomNav.tsx). Wallet is NOT a tab there — it is reached from
          the account side — and Games, which had no mobile equivalent at all, is the screen the
          felts are actually opened from. */}
      <Tabs.Screen
        name="Alliance"
        component={AllianceScreen}
        options={{
          title: t('nav.alliance'),
          tabBarIcon: ({ color, size }) => <AllianceIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Games"
        component={GamesScreen}
        options={{
          title: t('nav.games'),
          tabBarIcon: ({ color, size }) => <GamesIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Tables"
        component={LobbyScreen}
        options={{
          title: t('nav.lobby'),
          tabBarIcon: ({ color, size }) => <LobbyIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Data"
        component={DataScreen}
        options={{
          title: t('nav.data'),
          tabBarIcon: ({ color, size }) => <DataIcon color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="Account"
        component={ProfileScreen}
        options={{
          title: t('nav.account'),
          tabBarIcon: ({ color, size }) => <AccountIcon color={color} size={size} />,
        }}
      />
    </Tabs.Navigator>
  );
}

/**
 * The navigation tree, split out from `App` so it can call `useAuth()` —
 * which needs `AuthProvider` above it, which in turn needs `QueryClientProvider`
 * above IT (`signOut` clears the query cache). `AuthProvider` sits inside
 * `QueryClientProvider` but outside `NavigationContainer`: a signed-out user
 * renders `LoginScreen` directly, with nowhere to navigate to yet.
 */
function Root() {
  const { t } = useTranslation();
  const { status } = useAuth();
  const apiBase = useApiBase();

  if (status === 'loading') {
    // A cold start must not look like signed-out — that would flash the
    // login screen at someone who already has a session — so this state
    // renders neither the navigator nor LoginScreen, just a spinner.
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.brand} />
      </View>
    );
  }

  if (status === 'signedOut') {
    return <LoginScreen />;
  }

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      {/* A stack over the tabs, so a table opens WITH a tableId rather than
          being a tab that has to guess which table you meant. That param is
          half the seam with the game side; see src/navigation.ts. Vip,
          Notifications and Settings are pushed the same way, from the
          Account tab — see src/screens/ProfileScreen.tsx. */}
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
        <Stack.Screen name="Vip" component={VipScreen} options={{ title: t('account.vipMembership') }} />
        <Stack.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{ title: t('notifications.title') }}
        />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: t('account.settings') }} />
        <Stack.Screen
          name="AgentCenter"
          component={AgentCenterScreen}
          options={{ title: t('agent.title') }}
        />
        {/* Wallet came off the tab bar to match the Mini App, which reaches it from the account
            side (frontend/src/pages/Profile.tsx). Pushed, not dropped — see ProfileScreen. */}
        <Stack.Screen name="Wallet" component={WalletScreen} options={{ title: t('nav.wallet') }} />
      </Stack.Navigator>

      {/* Which gateway this build points at. Invisible in production, and the
          first question worth answering when a device "cannot load anything" —
          on an Android emulator the host is 10.0.2.2, never localhost. */}
      {__DEV__ && apiBase !== null && (
        <Text style={styles.devBanner}>{apiBase || 'No API URL set — open Settings'}</Text>
      )}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Root />
      </AuthProvider>
    </QueryClientProvider>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg },
  devBanner: {
    color: theme.dim,
    fontSize: 10,
    textAlign: 'center',
    paddingBottom: space.xs,
    backgroundColor: theme.bg,
  },
});
