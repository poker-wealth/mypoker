import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { api } from '../../api';
import { TABLE_DESIGNS, groundFor } from '../../table/tableDesigns';
import { useTableDesign } from '../../table/tableDesignStore';
import { RAISE_PRESETS, useTablePrefs } from '../../table/tablePrefs';
import { radius, space, theme, weight } from '../../theme';

/**
 * Personal settings and Host Options — the native twin of
 * `frontend/src/components/poker/TableSettingsSheet.tsx`.
 *
 * WHERE EACH SWITCH LIVES is the decision that matters, because a panel whose
 * switches do nothing is worse than no panel:
 *
 *  - table colour  → the design store, already persisted
 *  - GAME SOUND    → the ACCOUNT's `sound` field, the same row Settings writes,
 *                    so muting here mutes in Telegram too
 *  - everything else → `useTablePrefs`, local and honestly local
 *
 * HOST OPTIONS is shown only to the owner — and to everyone else it is not a
 * greyed tab but no tab at all, because "you are not the host" is not a state a
 * player needs a disabled control to learn.
 */

interface PlayerSettings {
  sound: boolean;
}

export function TableSettingsSheet({
  open,
  onClose,
  tableId,
  isOwner = false,
  seats = [],
  canStart = false,
  paused = false,
  closing = false,
  onStart,
  onKick,
  onPause,
  onCloseTable,
}: {
  open: boolean;
  onClose: () => void;
  tableId: string;
  isOwner?: boolean;
  seats?: { playerId: string; name: string; isYou: boolean }[];
  canStart?: boolean;
  paused?: boolean;
  closing?: boolean;
  onStart?: () => void;
  onKick?: (playerId: string) => void;
  onPause?: (next: boolean) => void;
  onCloseTable?: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'personal' | 'host'>('personal');
  const [customOpen, setCustomOpen] = useState(false);
  const { id: designId, setDesign } = useTableDesign();
  const prefs = useTablePrefs();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get<PlayerSettings>('/me/settings'),
    staleTime: 5 * 60_000,
  });

  const update = useMutation({
    mutationFn: (patch: Partial<PlayerSettings>) =>
      api.patch<PlayerSettings>('/me/settings', patch),
    onSuccess: (settled) => queryClient.setQueryData(['settings'], settled),
  });

  const hideInsurance = prefs.hideInsuranceFor.includes(tableId);
  const others = seats.filter((s) => !s.isYou);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.sheet}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.panel}>
          <View style={styles.tabs}>
            <Pressable onPress={() => setTab('personal')}>
              <Text style={[styles.tab, tab === 'personal' && styles.tabActive]}>
                {t('table.personalSettings')}
              </Text>
            </Pressable>
            {isOwner ? (
              <Pressable onPress={() => setTab('host')}>
                <Text style={[styles.tab, tab === 'host' && styles.tabActive]}>
                  {t('table.hostOptions')}
                </Text>
              </Pressable>
            ) : null}
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn}>
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <ScrollView bounces={false}>
            {tab === 'personal' ? (
              <>
                <Text style={styles.label}>{t('table.tableColour')}</Text>
                <View style={styles.swatches}>
                  {TABLE_DESIGNS.map((d) => {
                    const [inner, mid, outer] = groundFor(d);
                    return (
                      <Pressable
                        key={d.id}
                        onPress={() => setDesign(d.id)}
                        style={[styles.swatch, d.id === designId && styles.swatchActive]}
                      >
                        {/* The real gradient, not a flat approximation — the
                            swatch and the table must agree about a colour. */}
                        <Svg width="100%" height="100%">
                          <Defs>
                            <RadialGradient id={`sw-${d.id}`} cx="50%" cy="38%" r="70%">
                              <Stop offset="0%" stopColor={inner} />
                              <Stop offset="45%" stopColor={mid} />
                              <Stop offset="100%" stopColor={outer} />
                            </RadialGradient>
                          </Defs>
                          <Rect
                            x="0"
                            y="0"
                            width="100%"
                            height="100%"
                            fill={`url(#sw-${d.id})`}
                          />
                        </Svg>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.label}>{t('table.deckStyle')}</Text>
                <View style={styles.decks}>
                  {([true, false] as const).map((four) => (
                    <Pressable
                      key={String(four)}
                      onPress={() => prefs.setFourColour(four)}
                      // No box — only the chosen pair is ringed, as on the web.
                      style={[styles.deck, prefs.fourColour === four && styles.deckActive]}
                    >
                      {(
                        [
                          ['J', '♦', four ? '#2563eb' : '#e11d48'],
                          ['Q', '♣', four ? '#15803d' : '#111111'],
                          ['K', '♥', '#e11d48'],
                          ['A', '♠', '#111111'],
                        ] as const
                      ).map(([rank, suit, colour]) => (
                        <View key={suit} style={styles.miniCard}>
                          <Text style={[styles.miniText, { color: colour }]}>{rank}</Text>
                          <Text style={[styles.miniText, { color: colour }]}>{suit}</Text>
                        </View>
                      ))}
                    </Pressable>
                  ))}
                </View>

                <Text style={styles.label}>{t('table.defaultRaise')}</Text>
                <View style={styles.raises}>
                  <PlusCircle onPress={() => setCustomOpen((v) => !v)} label={t('table.customRaise')} />
                  {RAISE_PRESETS.map((preset) => (
                    <Pressable
                      key={preset.id}
                      onPress={() => prefs.setDefaultRaise(preset.id)}
                      style={[
                        styles.raise,
                        prefs.defaultRaise === preset.id && styles.raiseActive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.raiseText,
                          prefs.defaultRaise === preset.id && styles.raiseTextActive,
                        ]}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  ))}
                  <PlusCircle onPress={() => setCustomOpen((v) => !v)} label={t('table.customRaise')} />
                </View>

                {/* The reference's panel under the row. Opens a field for a
                    custom size rather than only describing one. */}
                <View style={styles.raiseBox}>
                  {customOpen ? (
                    <TextInput
                      value={prefs.customRaise === null ? '' : String(prefs.customRaise)}
                      onChangeText={(v) => {
                        const n = Number(v);
                        // Refused rather than stored as 0: a default raise of
                        // nothing is not a bet, and NaN would silently disable
                        // the preset on the next read.
                        prefs.setCustomRaise(Number.isFinite(n) && n > 0 ? n : null);
                      }}
                      keyboardType="decimal-pad"
                      placeholder="2.5"
                      placeholderTextColor={theme.dim}
                      style={styles.raiseInput}
                    />
                  ) : (
                    <>
                      <Text style={styles.raiseBoxTitle}>{t('table.setDefaultRaise')}</Text>
                      <Text style={styles.raiseBoxNote}>{t('table.customRaiseBlurb')}</Text>
                    </>
                  )}
                </View>

                <Switch
                  label={t('table.gameSound')}
                  // The ACCOUNT's setting. Off while it loads rather than
                  // guessing — a mute switch showing a guess is the bug this
                  // rule exists for.
                  value={settings.isSuccess ? settings.data.sound : false}
                  disabled={!settings.isSuccess || update.isPending}
                  onChange={(v) => update.mutate({ sound: v })}
                />
                <Switch
                  label={t('table.chattingSound')}
                  value={prefs.chatSound}
                  onChange={prefs.setChatSound}
                />
                {/* Disabled WITH its reason: insurance is not live at all, so
                    there is nothing for this to hide. The preference works;
                    only the control is off. */}
                <Switch
                  label={t('table.hideInsurance')}
                  hint={t('table.insuranceNotLive')}
                  value={hideInsurance}
                  disabled
                  onChange={(v) => prefs.setHideInsurance(tableId, v)}
                />
                <Switch
                  label={t('table.sliderConfirm')}
                  value={prefs.confirmBets}
                  onChange={prefs.setConfirmBets}
                />
              </>
            ) : (
              <>
                {canStart ? (
                  <Pressable
                    onPress={() => {
                      onStart?.();
                      onClose();
                    }}
                    style={styles.startBtn}
                  >
                    <Text style={styles.startText}>{t('table.startGame')}</Text>
                  </Pressable>
                ) : null}

                <Switch
                  label={paused ? t('table.resumeDealing') : t('table.pauseDealing')}
                  hint={t('table.pauseHint')}
                  value={paused}
                  onChange={(v) => onPause?.(v)}
                />

                <Text style={styles.label}>{t('table.removePlayer')}</Text>
                {others.length === 0 ? (
                  <Text style={styles.note}>{t('table.noOtherPlayers')}</Text>
                ) : (
                  others.map((seat) => (
                    <View key={seat.playerId} style={styles.kickRow}>
                      <Text style={styles.kickName} numberOfLines={1}>
                        {seat.name}
                      </Text>
                      <Pressable onPress={() => onKick?.(seat.playerId)} style={styles.kickBtn}>
                        <Text style={styles.kickText}>{t('table.remove')}</Text>
                      </Pressable>
                    </View>
                  ))
                )}
                <Text style={styles.note}>{t('table.removeBlurb')}</Text>

                {/* Last, and in danger red — it ends the table for everyone.
                    Once requested it reports the queued state rather than
                    offering itself again. */}
                {closing ? (
                  <Text style={styles.closingNote}>{t('table.closingBlurb')}</Text>
                ) : (
                  <>
                    <Pressable onPress={() => onCloseTable?.()} style={styles.closeTableBtn}>
                      <Text style={styles.closeTableText}>{t('table.closeTable')}</Text>
                    </Pressable>
                    <Text style={styles.note}>{t('table.closeBlurb')}</Text>
                  </>
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * The `+` at either end of the raise row.
 *
 * Both open the same custom-amount field — the reference puts one on each side
 * and they are the same control, not two different ones. Shared rather than
 * written twice so they cannot drift apart.
 */
function PlusCircle({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.raise}
    >
      <Text style={styles.raiseText}>+</Text>
    </Pressable>
  );
}

function Switch({
  label,
  hint,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchLabel}>
        <Text style={styles.switchText}>{label}</Text>
        {hint ? <Text style={styles.switchHint}>{hint}</Text> : null}
      </View>
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: value, disabled: Boolean(disabled) }}
        disabled={disabled}
        onPress={() => onChange(!value)}
        style={[styles.track, value && styles.trackOn, disabled && styles.trackOff]}
      >
        <View style={[styles.knob, value && styles.knobOn]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { flex: 1, justifyContent: 'center', paddingHorizontal: space.lg },
  panel: {
    maxHeight: '85%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: '#1c1a1b',
    padding: space.lg,
  },
  tabs: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.md },
  tab: { color: theme.dim, fontSize: 14, fontFamily: weight('700') },
  tabActive: { color: theme.text },
  closeBtn: { marginLeft: 'auto' },
  close: { color: theme.dim, fontSize: 17 },
  label: { color: theme.dim, fontSize: 11, marginBottom: 6, marginTop: space.sm },
  swatches: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  swatch: {
    // SQUARE, as the reference has them — `flex: 1` with a fixed height made
    // each one a wide rectangle instead.
    flex: 1,
    aspectRatio: 1,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  swatchActive: { borderColor: theme.brand },
  decks: { flexDirection: 'row', gap: space.sm, marginBottom: space.sm },
  deck: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  deckActive: { borderColor: theme.brand },
  miniCard: {
    width: 20,
    height: 28,
    borderRadius: 3,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniText: { fontSize: 8, fontFamily: weight('800') },
  raises: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: space.md,
    marginBottom: space.md,
  },
  raise: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  raiseActive: { borderColor: theme.brand, backgroundColor: 'rgba(217,184,124,0.15)' },
  raiseText: { color: theme.dim, fontSize: 14, fontFamily: weight('700') },
  /* The panel under the raise row, as the reference has it. */
  raiseBox: {
    borderRadius: radius.card,
    backgroundColor: 'rgba(0,0,0,0.3)',
    paddingVertical: space.lg,
    paddingHorizontal: space.md,
    alignItems: 'center',
    marginBottom: space.sm,
  },
  raiseBoxTitle: { color: theme.text, fontSize: 13, fontFamily: weight('700') },
  raiseBoxNote: { color: theme.dim, fontSize: 11, marginTop: 2, textAlign: 'center' },
  raiseInput: {
    width: '100%',
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    color: theme.text,
    fontSize: 15,
    textAlign: 'center',
    paddingVertical: 8,
  },
  raiseTextActive: { color: theme.brand },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: 10,
  },
  switchLabel: { flex: 1 },
  switchText: { color: theme.text, fontSize: 13 },
  switchHint: { color: theme.dim, fontSize: 9, marginTop: 1 },
  track: {
    width: 44,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface2,
    justifyContent: 'center',
  },
  trackOn: { backgroundColor: theme.brand, borderColor: theme.brand },
  trackOff: { opacity: 0.5 },
  knob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    marginLeft: 1,
  },
  knobOn: { marginLeft: 22 },
  startBtn: {
    borderRadius: radius.card,
    backgroundColor: theme.brand,
    paddingVertical: 11,
    alignItems: 'center',
    marginBottom: space.sm,
  },
  startText: { color: theme.bg, fontSize: 14, fontFamily: weight('800') },
  note: { color: theme.dim, fontSize: 10, marginTop: 6, lineHeight: 14 },
  kickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  kickName: { flex: 1, color: theme.text, fontSize: 13 },
  kickBtn: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(248,86,119,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  kickText: { color: theme.danger, fontSize: 11, fontFamily: weight('700') },
  closeTableBtn: {
    marginTop: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: 'rgba(248,86,119,0.6)',
    paddingVertical: 11,
    alignItems: 'center',
  },
  closeTableText: { color: theme.danger, fontSize: 14, fontFamily: weight('800') },
  closingNote: {
    color: theme.accent,
    fontSize: 12,
    textAlign: 'center',
    marginTop: space.md,
    fontFamily: weight('600'),
  },
});
