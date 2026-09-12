import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { radius, space, theme, weight } from '../../theme';
import type { ChatMessage } from './ChatBox';

/**
 * The comment sheet — the native twin of
 * `frontend/src/components/poker/CommentSheet.tsx`.
 *
 * ITS OWN PANEL, separate from chat. On the web an earlier pass bolted these
 * onto the chat box, which put them in front of every ordinary message and in
 * the way of the voice recorder; the two share only the send path here.
 *
 * WIRED: the composer and the quick phrases both send an ordinary chat message,
 * so the server needs nothing new. History is the same table chat log,
 * read-only.
 *
 * NOT WIRED, and drawn anyway: the 10 / 50 / 100 tiers. Those spend real chips,
 * which means `transfer()` in financial-core and senior review (iron rules 1
 * and 5); no socket command carries a paid comment and no ledger type covers
 * one. They are drawn because the tiers are the owner's design, and disabled
 * with a readable reason because a chip-spending button that quietly does
 * nothing is the worst version of this control.
 */

/**
 * The canned lines, as KEYS rather than sentences — translated like every other
 * string. A phrase hardcoded in English on a Chinese table is exactly the
 * mistake the eight-locale rule exists to prevent, and these are the one kind
 * of message a player sends without typing it.
 */
const QUICK_PHRASES = [
  'table.phraseShowChips',
  'table.phraseNotLuck',
  'table.phraseNeverSayDie',
  'table.phraseNothingSeek',
  'table.phraseWheelTurns',
  'table.phraseCardsAreWar',
] as const;

/** Chip costs the reference offers. Drawn, not wired — see above. */
const PAID_TIERS = [10, 50, 100] as const;

const MAX_LENGTH = 36;

export function CommentSheet({
  open,
  onClose,
  onSend,
  messages,
  disabled = false,
}: {
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  messages: ChatMessage[];
  /** Spectators cannot comment; the server refuses it either way. */
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'comment' | 'history'>('comment');
  const [input, setInput] = useState('');

  const send = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput('');
  };

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        {/* A bottom sheet, so the table stays visible above — a player should
            be able to watch the hand they are talking about. */}
        <View style={[styles.panel, { paddingBottom: insets.bottom + space.md }]}>
          <View style={styles.tiers}>
            {PAID_TIERS.map((cost) => (
              <View key={cost} style={styles.tier}>
                <Text style={styles.tierLabel}>{t('table.comment')}</Text>
                <Text style={styles.tierCost}>{cost} ●</Text>
              </View>
            ))}
          </View>
          <Text style={styles.tierNote}>{t('table.paidCommentSoon')}</Text>

          {tab === 'comment' ? (
            <>
              <View style={styles.composer}>
                <TextInput
                  value={input}
                  onChangeText={(v) => setInput(v.slice(0, MAX_LENGTH))}
                  editable={!disabled}
                  placeholder={disabled ? t('table.chatDisabled') : t('table.commentPlaceholder')}
                  placeholderTextColor={theme.dim}
                  style={styles.input}
                  onSubmitEditing={() => send(input)}
                  returnKeyType="send"
                />
                {/* Live counter, so a player knows before they hit the wall. */}
                <Text style={styles.counter}>
                  {input.length}/{MAX_LENGTH}
                </Text>
              </View>

              <ScrollView bounces={false} style={styles.list}>
                {QUICK_PHRASES.map((key) => (
                  <Pressable
                    key={key}
                    disabled={disabled}
                    onPress={() => send(t(key))}
                    style={({ pressed }) => [styles.phrase, pressed && styles.phrasePressed]}
                  >
                    <Text style={styles.bullet}>•</Text>
                    <Text style={styles.phraseText}>{t(key)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            </>
          ) : (
            <ScrollView bounces={false} style={styles.list}>
              {messages.length === 0 ? (
                <Text style={styles.empty}>{t('table.noComments')}</Text>
              ) : (
                messages.map((msg) => (
                  <View key={msg.id} style={styles.historyRow}>
                    <Text style={styles.historyName}>{msg.senderName}</Text>
                    {/* A voice note has no text to print; name it rather than
                        rendering an empty line. */}
                    <Text style={styles.historyText}>{msg.text ?? t('table.voiceNote')}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          )}

          <View style={styles.tabs}>
            {(['comment', 'history'] as const).map((which) => (
              <Pressable key={which} onPress={() => setTab(which)} style={styles.tab}>
                <Text style={[styles.tabText, tab === which && styles.tabActive]}>
                  {which === 'comment' ? t('table.comment') : t('table.history')}
                </Text>
                {tab === which ? <View style={styles.tabUnderline} /> : null}
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { flex: 1, justifyContent: 'flex-end' },
  panel: {
    maxHeight: '70%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderTopWidth: 1,
    borderColor: theme.border,
    backgroundColor: '#141013',
    paddingBottom: space.md,
  },
  tiers: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.md, paddingTop: space.md },
  tier: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingVertical: 7,
    opacity: 0.8,
  },
  tierLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontFamily: weight('700') },
  /* Gold, matching the Mini App — the money-cyan is for pots and balances. */
  tierCost: { color: '#e8b93b', fontSize: 11, fontFamily: weight('700') },
  tierNote: { color: theme.dim, fontSize: 9, paddingHorizontal: space.lg, paddingTop: 4 },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingTop: space.md,
  },
  input: {
    flex: 1,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: 'rgba(0,0,0,0.35)',
    color: theme.text,
    fontSize: 13,
    paddingHorizontal: space.md,
    paddingVertical: 9,
  },
  counter: { color: theme.dim, fontSize: 10, width: 42, textAlign: 'right' },
  list: { paddingHorizontal: space.lg, marginTop: space.sm },
  phrase: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  phrasePressed: { opacity: 0.6 },
  bullet: { color: '#e8b93b', fontSize: 14 },
  phraseText: { flex: 1, color: theme.text, fontSize: 13 },
  empty: { color: theme.dim, fontSize: 12, textAlign: 'center', paddingVertical: space.xl },
  historyRow: {
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  historyName: { color: theme.dim, fontSize: 11, fontFamily: weight('700') },
  historyText: { color: theme.text, fontSize: 13 },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    marginTop: space.sm,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 11 },
  tabText: { color: theme.dim, fontSize: 13, fontFamily: weight('600') },
  tabActive: { color: '#e8b93b' },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    height: 2,
    width: 48,
    backgroundColor: '#e8b93b',
  },
});
