import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { Button } from '../ui';

/** A single confirmation point the inspector must acknowledge before starting. */
export interface ConfirmStartItem {
  id: string;
  label: string;
}

const DEFAULT_ITEMS: ConfirmStartItem[] = [
  { id: 'access', label: 'I have reviewed access instructions' },
  { id: 'concerns', label: 'I have reviewed client concerns' },
  { id: 'onsite', label: 'I am onsite and ready to begin inspection' },
];

interface ConfirmStartModalProps {
  visible: boolean;
  onCancel: () => void;
  /** Fired once every checklist item is acknowledged and the inspector confirms. */
  onConfirm: () => void;
  /** Override the default acknowledgement checklist. */
  items?: ConfirmStartItem[];
  /** Disables the confirm button (e.g. while the start request is in flight). */
  loading?: boolean;
}

/**
 * Pre-start confirmation sheet for the inspection flow.
 * Surfaced from a "Start Inspection" CTA — the inspector must tick every
 * acknowledgement before the inspection can be marked In Progress.
 */
export function ConfirmStartModal({
  visible,
  onCancel,
  onConfirm,
  items = DEFAULT_ITEMS,
  loading = false,
}: ConfirmStartModalProps) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const checkedCount = useMemo(() => items.filter((item) => checked[item.id]).length, [items, checked]);
  const allChecked = checkedCount === items.length;

  const toggle = (id: string) =>
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));

  // Reset acknowledgements whenever the sheet is dismissed.
  const handleCancel = () => {
    setChecked({});
    onCancel();
  };

  const handleConfirm = () => {
    if (!allChecked || loading) return;
    onConfirm();
    setChecked({});
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleCancel}
    >
      <View style={styles.backdrop}>
        {/* Tap outside to dismiss. */}
        <Pressable style={StyleSheet.absoluteFill} onPress={handleCancel} />

        <View style={styles.card}>
          {/* Icon badge */}
          <View style={styles.iconWrap}>
            <View style={styles.iconTile}>
              <Ionicons name="clipboard-outline" size={28} color={colors.textPrimary} />
            </View>
            <View style={styles.badge}>
              <Ionicons name="checkmark" size={12} color={colors.white} />
            </View>
          </View>

          <Text style={styles.title}>Start Inspection?</Text>
          <Text style={styles.subtitle}>
            You are about to begin this inspection. Please confirm that you have
            arrived onsite and reviewed the job details, safety information, and
            access instructions.
          </Text>

          {/* Acknowledgement checklist */}
          <View style={styles.checklist}>
            {items.map((item) => {
              const isChecked = !!checked[item.id];
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isChecked }}
                  onPress={() => toggle(item.id)}
                  style={styles.checkRow}
                  hitSlop={6}
                >
                  <View style={[styles.box, isChecked && styles.boxChecked]}>
                    {isChecked && (
                      <Ionicons name="checkmark" size={14} color={colors.white} />
                    )}
                  </View>
                  <Text style={styles.checkLabel}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {/* Info banner */}
          <View style={styles.banner}>
            <Ionicons name="information-circle" size={18} color={colors.infoFg} />
            <Text style={styles.bannerText}>
              Once started, the inspection status will change to{' '}
              <Text style={styles.bannerBold}>In Progress</Text> and the start
              time will be recorded.
            </Text>
          </View>

          {/* Live progress hint — flips from a muted count to a green "ready" state as items are ticked. */}
          <View style={styles.readyHint}>
            <Ionicons
              name={allChecked ? 'checkmark-circle' : 'ellipse-outline'}
              size={16}
              color={allChecked ? colors.success : colors.textMuted}
            />
            <Text style={[styles.readyHintText, allChecked && styles.readyHintTextDone]}>
              {allChecked
                ? 'All items confirmed — ready to start'
                : `${checkedCount} of ${items.length} confirmed`}
            </Text>
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="outline"
              onPress={handleCancel}
              style={styles.actionBtn}
            />
            <Button
              label="Start"
              variant="primaryGradient"
              disabled={!allChecked}
              loading={loading}
              onPress={handleConfirm}
              style={styles.actionBtn}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 25, 40, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.xl,
    ...shadows.card,
  },
  iconWrap: { alignSelf: 'center', marginBottom: spacing.lg },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 22,
    height: 22,
    borderRadius: radius.pill,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  title: {
    ...typography.h2,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.bodySm,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 19,
    marginBottom: spacing.xl,
  },
  checklist: { gap: spacing.md, marginBottom: spacing.xl },
  checkRow: { flexDirection: 'row', alignItems: 'center' },
  box: {
    width: 20,
    height: 20,
    borderRadius: radius.sm - 2,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  boxChecked: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkLabel: {
    ...typography.bodySm,
    color: colors.textPrimary,
    marginLeft: spacing.md,
    flex: 1,
  },
  banner: {
    flexDirection: 'row',
    backgroundColor: colors.infoBg,
    borderWidth: 1,
    borderColor: colors.infoBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  bannerText: {
    ...typography.bodySm,
    color: colors.infoFg,
    flex: 1,
    marginLeft: spacing.sm,
    lineHeight: 18,
  },
  bannerBold: { fontWeight: '700' },
  readyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  readyHintText: { ...typography.caption, fontWeight: '700', color: colors.textMuted },
  readyHintTextDone: { color: colors.success },
  actions: { flexDirection: 'row', gap: spacing.md },
  actionBtn: { flex: 1 },
});
