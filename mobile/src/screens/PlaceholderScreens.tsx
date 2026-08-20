import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

/**
 * Lobby, Alliance, Data and My Account.
 *
 * These are laid out to match the Mini App's arrangement — same sections in the same order — but
 * the figures are NOT invented. Every one of these screens is fed by the gateway API, and the API
 * client is the app shell's half; until it lands, each row shows an em dash.
 *
 * That is deliberate rather than lazy. A placeholder balance or a made-up win rate is a claim about
 * someone's money, and a screen that lies convincingly is worse than one that admits it is empty.
 * The web app makes the same choice: its jackpot hero shows an em dash when the lobby cannot be
 * reached, never "$ 0.00".
 */

const EMPTY = '—';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Row({ label, value, icon }: { label: string; value?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        {icon && <Ionicons name={icon} size={17} color={colors.dim} />}
        <Text style={styles.rowLabel}>{label}</Text>
      </View>
      <Text style={styles.rowValue}>{value ?? EMPTY}</Text>
    </View>
  );
}

/** Home. The Mini App leads with the balance, then quick entry points. */
export function LobbyScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>BALANCE</Text>
        <Text style={styles.balanceValue}>{EMPTY}</Text>
        <Text style={styles.awaiting}>waiting on the wallet API</Text>
      </View>

      <Section title="QUICK ACTIONS">
        <Row label="Deposit" icon="arrow-down-circle-outline" value=" " />
        <Row label="Withdraw" icon="arrow-up-circle-outline" value=" " />
        <Row label="Provably fair" icon="shield-checkmark-outline" value=" " />
      </Section>

      <Section title="TODAY">
        <Row label="Hands played" />
        <Row label="Net" />
      </Section>
    </ScrollView>
  );
}

/** Referrals and team, per the Mini App's Alliance page. */
export function AllianceScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Section title="YOUR ALLIANCE">
        <Row label="Members" icon="people-outline" />
        <Row label="Commission earned" icon="cash-outline" />
        <Row label="Referral link" icon="link-outline" />
      </Section>
      <Section title="TIERS">
        <Row label="Direct" />
        <Row label="Sub-agents" />
      </Section>
      <Text style={styles.note}>Fed by the agent API — the app shell's half.</Text>
    </ScrollView>
  );
}

/** Play statistics. */
export function DataScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Section title="PERFORMANCE">
        <Row label="Hands played" icon="albums-outline" />
        <Row label="Win rate" icon="trending-up-outline" />
        <Row label="Biggest pot" icon="trophy-outline" />
      </Section>
      <Section title="BY GAME">
        <Row label="Hold'em" />
        <Row label="Niu Niu" />
        <Row label="Dou Di Zhu" />
      </Section>
      <Text style={styles.note}>Fed by /me/stats — the app shell's half.</Text>
    </ScrollView>
  );
}

/** My Account. Wallet hangs off here rather than the tab bar, as in the Mini App. */
export function ProfileScreen() {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.profileHead}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={26} color={colors.dim} />
        </View>
        <View>
          <Text style={styles.name}>Not signed in</Text>
          <Text style={styles.dim}>sign-in is the shell's half</Text>
        </View>
      </View>

      <Section title="WALLET">
        <Row label="Balance" icon="wallet-outline" />
        <Row label="Deposit" icon="arrow-down-circle-outline" value=" " />
        <Row label="Withdraw" icon="arrow-up-circle-outline" value=" " />
        <Row label="Transactions" icon="receipt-outline" value=" " />
      </Section>

      <Section title="ACCOUNT">
        <Row label="VIP tier" icon="diamond-outline" />
        <Row label="Reputation" icon="ribbon-outline" />
        <Row label="Notifications" icon="notifications-outline" value=" " />
        <Row label="Settings" icon="settings-outline" value=" " />
      </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  section: { gap: 8 },
  sectionTitle: { color: colors.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { color: colors.text, fontSize: 14 },
  rowValue: { color: colors.dim, fontSize: 14, fontWeight: '600' },
  balanceCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: 20,
    alignItems: 'center',
    gap: 2,
  },
  balanceLabel: { color: colors.dim, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  balanceValue: { color: colors.text, fontSize: 32, fontWeight: '900' },
  awaiting: { color: colors.dim, fontSize: 11, fontStyle: 'italic' },
  profileHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  dim: { color: colors.dim, fontSize: 12 },
  note: { color: colors.dim, fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
});
