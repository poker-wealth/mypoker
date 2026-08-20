import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import type { RootStackParamList } from '../navigation';
import { space, theme } from '../theme';
import { Card, ListRow } from '../ui';

/**
 * Account — the tab this hangs off. It has no web equivalent 1:1 (the Mini
 * App's menu lives on Profile, `frontend/src/pages/Profile.tsx`, alongside
 * balance and sign-in state this shell does not yet expose reactively), so
 * this is a minimal stand-in: just the doors to the three ported screens.
 * Everything else on that web menu (fairness, invite, support) stays
 * unported — out of scope for this pass.
 */
export function AccountScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <ListRow
          label={t('account.vipMembership')}
          hint={t('account.checkPrivileges')}
          onPress={() => navigation.navigate('Vip')}
        />
        <ListRow
          label={t('account.messageCenter')}
          onPress={() => navigation.navigate('Notifications')}
        />
        <ListRow
          label={t('account.settings')}
          onPress={() => navigation.navigate('Settings')}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  content: { padding: space.lg },
  card: { padding: 0, paddingHorizontal: space.md, gap: 0 },
});
