import React, { useRef, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, typography } from '../../theme';
import { CapturedPhoto } from '../../types/photo';

/**
 * Shared building blocks for inspection section screens (Paving & Paths,
 * Fences, Retaining Walls, …). Keeps the rich per-section forms consistent and
 * DRY. All visuals use theme tokens + Ionicons (the native equivalents of the
 * web reference's Tailwind/lucide/motion).
 */

/* ─── Shared types ─────────────────────────────────────────────────── */
export type ItemStatus = 'pending' | 'in-progress' | 'complete';

export interface CrackEntry {
  id: number;
  location: string;
  startingPoint: string;
  direction: string;
  widthMm: string;
  lengthMm: string;
}

export function makeCrack(id: number): CrackEntry {
  return { id, location: '', startingPoint: '', direction: '', widthMm: '', lengthMm: '' };
}

/** A structured damage/crack record (typed defect: type, location, dimensions, photos). */
export interface DamageRecord {
  id: number;
  damageType: string;
  location: string;
  direction: string;
  widthMm: string;
  lengthMm: string;
  notes: string;
  photos: import('../../types/photo').CapturedPhoto[];
}

export function makeDamageRecord(id: number): DamageRecord {
  return { id, damageType: '', location: '', direction: '', widthMm: '', lengthMm: '', notes: '', photos: [] };
}

export const DAMAGE_DIRECTIONS = ['Vertical', 'Horizontal', 'Diagonal'];

export interface ColorOption {
  value: string;
  label: string;
  color: string;
}

export const CRACK_DIRECTIONS = ['Longitudinal', 'Transverse', 'Diagonal', 'Stair-step', 'Random / Map'];

/* ─── Labels & inputs ──────────────────────────────────────────────── */
export function SectionLabel({ n, children }: { n?: number; children: React.ReactNode }) {
  return (
    <Text style={styles.sectionLabel}>
      {n != null && <Text style={styles.sectionNum}>{n}. </Text>}
      {children}
    </Text>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function MiniLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.miniLabel}>{children}</Text>;
}

export function FieldInput(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput placeholderTextColor={colors.textMuted} {...props} style={[styles.input, props.style]} />;
}

/* ─── Chips ────────────────────────────────────────────────────────── */
export function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

export function PillSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => (
        <Chip key={o} label={o} active={value === o} onPress={() => onChange(value === o ? '' : o)} />
      ))}
    </View>
  );
}

export function ChipMultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: string[];
  selected: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => (
        <Chip key={o} label={o} active={selected.includes(o)} onPress={() => onToggle(o)} />
      ))}
    </View>
  );
}

export function YesNoToggle({
  value,
  onChange,
}: {
  value: 'yes' | 'no' | null;
  onChange: (v: 'yes' | 'no') => void;
}) {
  return (
    <View style={styles.row}>
      {(['yes', 'no'] as const).map((v) => {
        const active = value === v;
        const accent = v === 'yes' ? colors.barBlue : colors.primary;
        return (
          <Pressable
            key={v}
            onPress={() => onChange(v)}
            style={[
              styles.yesNo,
              active && {
                borderColor: accent,
                backgroundColor: v === 'yes' ? colors.accentBlue : colors.primaryTint,
              },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <Text style={[styles.yesNoText, { color: active ? accent : colors.textMuted }]}>
              {v === 'yes' ? 'Yes' : 'No'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Single-select list of colour-coded options (condition / severity). */
export function ColorOptionList({
  options,
  value,
  onChange,
}: {
  options: ColorOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(active ? '' : o.value)}
            style={[styles.optionRow, active && { borderColor: o.color, backgroundColor: colors.surfaceAlt }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
          >
            <View style={[styles.optionDot, { backgroundColor: o.color }]} />
            <Text style={[styles.optionText, { color: active ? o.color : colors.textMuted, fontWeight: active ? '700' : '500' }]}>
              {o.label}
            </Text>
            {active && <Ionicons name="checkmark" size={16} color={o.color} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Compact colour-coded severity row (No Issue / Minor / Major). */
export function SeverityRow({
  options,
  value,
  onChange,
}: {
  options: ColorOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.row}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(active ? '' : o.value)}
            style={[styles.severityBtn, active && { borderColor: o.color, backgroundColor: colors.surfaceAlt }]}
          >
            <Text style={[styles.severityText, { color: active ? o.color : colors.textMuted }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── Crack card ───────────────────────────────────────────────────── */
export function CrackCard({
  crack,
  index,
  onUpdate,
  onRemove,
  canRemove,
}: {
  crack: CrackEntry;
  index: number;
  onUpdate: (updates: Partial<CrackEntry>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  return (
    <View style={styles.crackCard}>
      <View style={styles.crackHeader}>
        <View style={styles.row}>
          <View style={styles.crackBadge}>
            <Text style={styles.crackBadgeText}>{index + 1}</Text>
          </View>
          <Text style={styles.crackTitle}>Crack {index + 1}</Text>
        </View>
        {canRemove && (
          <Pressable onPress={onRemove} hitSlop={8} accessibilityLabel={`Remove crack ${index + 1}`}>
            <Ionicons name="trash-outline" size={15} color={colors.textMuted} />
          </Pressable>
        )}
      </View>
      <View style={styles.crackBody}>
        <View style={styles.row}>
          <View style={styles.flex1}>
            <MiniLabel>Location</MiniLabel>
            <FieldInput placeholder="e.g. Base / centre" value={crack.location} onChangeText={(v) => onUpdate({ location: v })} />
          </View>
          <View style={styles.flex1}>
            <MiniLabel>Starting Point</MiniLabel>
            <FieldInput placeholder="e.g. Along edge" value={crack.startingPoint} onChangeText={(v) => onUpdate({ startingPoint: v })} />
          </View>
        </View>
        <View>
          <MiniLabel>Direction</MiniLabel>
          <PillSelect options={CRACK_DIRECTIONS} value={crack.direction} onChange={(v) => onUpdate({ direction: v })} />
        </View>
        <View style={styles.row}>
          <View style={styles.flex1}>
            <MiniLabel>Width (mm)</MiniLabel>
            <FieldInput placeholder="0" keyboardType="numeric" value={crack.widthMm} onChangeText={(v) => onUpdate({ widthMm: v })} />
          </View>
          <View style={styles.flex1}>
            <MiniLabel>Length (mm)</MiniLabel>
            <FieldInput placeholder="0" keyboardType="numeric" value={crack.lengthMm} onChangeText={(v) => onUpdate({ lengthMm: v })} />
          </View>
        </View>
      </View>
    </View>
  );
}

/* ─── Photo strip ──────────────────────────────────────────────────── */
export function PhotoStrip({
  photos,
  onCapture,
}: {
  photos: CapturedPhoto[];
  onCapture: (kind: 'camera' | 'library') => void;
}) {
  return (
    <View>
      {photos.length > 0 && (
        <View style={styles.thumbGrid}>
          {photos.map((p) => (
            <Image key={p.id} source={{ uri: p.uri }} style={styles.thumb} />
          ))}
        </View>
      )}
      <View style={styles.row}>
        <Pressable onPress={() => onCapture('camera')} style={[styles.captureBtn, styles.captureBlue]}>
          <Ionicons name="camera-outline" size={14} color={colors.barBlue} />
          <Text style={[styles.captureText, { color: colors.barBlue }]}>Take Photo</Text>
        </Pressable>
        <Pressable onPress={() => onCapture('library')} style={[styles.captureBtn, styles.capturePurple]}>
          <Ionicons name="image-outline" size={14} color={colors.barPurple} />
          <Text style={[styles.captureText, { color: colors.barPurple }]}>Upload Photo</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ─── Damage record card (typed defect: type/location/dir/dims/notes/photos) ─ */
export function DamageRecordCard({
  record,
  damageTypes,
  onUpdate,
  onDelete,
  onCapture,
}: {
  record: DamageRecord;
  damageTypes: string[];
  onUpdate: (id: number, u: Partial<DamageRecord>) => void;
  onDelete: (id: number) => void;
  onCapture: (id: number, kind: 'camera' | 'library') => void;
}) {
  return (
    <View style={styles.recordCard}>
      <View style={styles.recordHeader}>
        <Text style={styles.recordTitle}>Damage / Crack Record</Text>
        <Pressable onPress={() => onDelete(record.id)} hitSlop={8} accessibilityLabel="Delete record">
          <Ionicons name="trash-outline" size={15} color={colors.danger} />
        </Pressable>
      </View>

      <MiniLabel>Damage Type</MiniLabel>
      <PillSelect options={damageTypes} value={record.damageType} onChange={(v) => onUpdate(record.id, { damageType: v })} />

      <View style={styles.recordMt}>
        <MiniLabel>Damage Location</MiniLabel>
        <FieldInput placeholder="Describe the damage location..." value={record.location} onChangeText={(v) => onUpdate(record.id, { location: v })} />
      </View>

      <View style={styles.recordMt}>
        <MiniLabel>Direction</MiniLabel>
        <PillSelect options={DAMAGE_DIRECTIONS} value={record.direction} onChange={(v) => onUpdate(record.id, { direction: v })} />
      </View>

      <View style={[styles.recordRow, styles.recordMt]}>
        <View style={styles.recordFlex}>
          <MiniLabel>Width (mm)</MiniLabel>
          <FieldInput placeholder="mm" keyboardType="numeric" value={record.widthMm} onChangeText={(v) => onUpdate(record.id, { widthMm: v })} />
        </View>
        <View style={styles.recordFlex}>
          <MiniLabel>Length (mm)</MiniLabel>
          <FieldInput placeholder="mm" keyboardType="numeric" value={record.lengthMm} onChangeText={(v) => onUpdate(record.id, { lengthMm: v })} />
        </View>
      </View>

      <View style={styles.recordMt}>
        <MiniLabel>Inspector Notes</MiniLabel>
        <FieldInput
          style={styles.recordTextarea}
          placeholder="Notes about this damage..."
          value={record.notes}
          onChangeText={(v) => onUpdate(record.id, { notes: v })}
          multiline
          textAlignVertical="top"
        />
      </View>

      <View style={styles.recordMt}>
        <PhotoStrip photos={record.photos} onCapture={(k) => onCapture(record.id, k)} />
      </View>
    </View>
  );
}

/* ─── Header (gradient + status + condition + pager) ───────────────── */
export interface PagerProps {
  index: number;
  total: number;
  unit: string;
  onPrev: () => void;
  onNext: () => void;
}

const STATUS_HEADER: Record<ItemStatus, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Not Started', bg: 'rgba(255,255,255,0.12)', fg: 'rgba(255,255,255,0.6)' },
  'in-progress': { label: 'In Progress', bg: 'rgba(147,197,253,0.2)', fg: '#93C5FD' },
  complete: { label: '✓ Complete', bg: 'rgba(134,239,172,0.2)', fg: '#86EFAC' },
};

export function SectionGradientHeader({
  eyebrow,
  title,
  status,
  conditionLabel,
  conditionColor,
  pager,
  onBack,
  onSave,
  onHome,
}: {
  eyebrow: string;
  title: string;
  status: ItemStatus;
  conditionLabel?: string;
  conditionColor?: string;
  pager?: PagerProps;
  onBack: () => void;
  onSave?: () => void;
  onHome?: () => void;
}) {
  const s = STATUS_HEADER[status];
  return (
    <LinearGradient colors={[colors.headerGradientFrom, colors.headerGradientTo]} style={styles.header}>
      <SafeAreaView edges={['top']}>
        <View style={styles.headerTopRow}>
          <Pressable onPress={onBack} style={styles.backRow} hitSlop={8}>
            <Ionicons name="arrow-back" size={15} color={colors.textOnDarkMuted} />
            <Text style={styles.backText}>External Inspection</Text>
          </Pressable>
          <View style={styles.row}>
            {onSave && (
              <Pressable onPress={onSave} style={styles.headerIconBtn} hitSlop={8} accessibilityLabel="Save draft">
                <Ionicons name="save-outline" size={14} color={colors.white} />
              </Pressable>
            )}
            {onHome && (
              <Pressable onPress={onHome} style={styles.headerIconBtn} hitSlop={8} accessibilityLabel="Home">
                <Ionicons name="home-outline" size={14} color={colors.white} />
              </Pressable>
            )}
          </View>
        </View>

        <View style={styles.headerTitleRow}>
          <View style={styles.flex1}>
            <Text style={styles.headerEyebrow}>{eyebrow}</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <View style={styles.badgeRow}>
              <View style={[styles.badge, { backgroundColor: s.bg }]}>
                <Text style={[styles.badgeText, { color: s.fg }]}>{s.label}</Text>
              </View>
              {conditionLabel && conditionColor && (
                <View style={[styles.badge, { backgroundColor: conditionColor + '33' }]}>
                  <Text style={[styles.badgeText, { color: conditionColor }]}>{conditionLabel}</Text>
                </View>
              )}
            </View>
          </View>

          {pager && (
            <View style={styles.pager}>
              <Pressable
                onPress={pager.onPrev}
                disabled={pager.index === 0}
                style={[styles.pagerBtn, pager.index === 0 && styles.pagerBtnOff]}
                hitSlop={6}
              >
                <Ionicons name="chevron-back" size={13} color={pager.index === 0 ? 'rgba(255,255,255,0.25)' : colors.white} />
              </Pressable>
              <View style={styles.pagerLabel}>
                <Text style={styles.pagerCount}>{pager.index + 1}/{pager.total}</Text>
                <Text style={styles.pagerUnit}>{pager.unit}</Text>
              </View>
              <Pressable
                onPress={pager.onNext}
                disabled={pager.index === pager.total - 1}
                style={[styles.pagerBtn, pager.index === pager.total - 1 && styles.pagerBtnOff]}
                hitSlop={6}
              >
                <Ionicons
                  name="chevron-forward"
                  size={13}
                  color={pager.index === pager.total - 1 ? 'rgba(255,255,255,0.25)' : colors.white}
                />
              </Pressable>
            </View>
          )}
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

/* ─── Toast ────────────────────────────────────────────────────────── */
export function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (msg: string) => {
    setToast(msg);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2200);
  };
  return { toast, show };
}

export function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.toast} pointerEvents="none">
      <Text style={styles.toastText}>{message}</Text>
    </View>
  );
}

/* ─── Styles ───────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  /* Header */
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { ...typography.caption, color: colors.textOnDarkMuted },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: spacing.md },
  headerEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: 'rgba(255,255,255,0.5)', marginBottom: 2 },
  headerTitle: { ...typography.h2, color: colors.white },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  badge: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill },
  badgeText: { fontSize: 10, fontWeight: '700' },
  pager: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginLeft: spacing.sm },
  pagerBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pagerBtnOff: { backgroundColor: 'rgba(255,255,255,0.05)' },
  pagerLabel: { alignItems: 'center', minWidth: 36 },
  pagerCount: { fontSize: 11, fontWeight: '700', color: colors.white },
  pagerUnit: { fontSize: 9, color: 'rgba(255,255,255,0.4)' },

  /* Card + labels */
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
    ...shadows.card,
  },
  sectionLabel: { ...typography.sectionTitle, color: colors.textSecondary, textTransform: 'uppercase', marginBottom: spacing.sm },
  sectionNum: { color: colors.barBlue },
  miniLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing.xs,
  },

  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex1: { flex: 1 },

  /* Inputs */
  input: {
    ...typography.bodySm,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  /* Chips */
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  chipActive: { backgroundColor: colors.headerGradientFrom },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextActive: { color: colors.white, fontWeight: '700' },

  /* Yes / No */
  yesNo: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  yesNoText: { ...typography.bodySm, fontWeight: '700' },

  /* Colour option rows */
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  optionDot: { width: 10, height: 10, borderRadius: 5 },
  optionText: { ...typography.bodySm, flex: 1 },

  /* Severity */
  severityBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  severityText: { ...typography.caption, fontWeight: '700' },

  /* Crack card */
  crackCard: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt, overflow: 'hidden', marginBottom: spacing.sm },
  crackHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  crackBadge: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.barBlue, alignItems: 'center', justifyContent: 'center' },
  crackBadgeText: { fontSize: 10, fontWeight: '800', color: colors.white },
  crackTitle: { ...typography.bodySm, fontWeight: '700', color: colors.textPrimary },
  crackBody: { padding: spacing.md, gap: spacing.md },

  /* Photos */
  thumbGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  captureBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  captureBlue: { borderColor: colors.infoBorder, backgroundColor: colors.accentBlue },
  capturePurple: { borderColor: '#DDD6FE', backgroundColor: colors.accentPurple },
  captureText: { fontSize: 11, fontWeight: '700' },

  /* Damage record card */
  recordCard: { borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FFF7F7', borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm },
  recordHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  recordTitle: { ...typography.caption, fontWeight: '700', color: colors.danger },
  recordMt: { marginTop: spacing.sm },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  recordFlex: { flex: 1 },
  recordTextarea: { minHeight: 56 },

  /* Toast */
  toast: {
    position: 'absolute',
    bottom: 130,
    left: spacing.lg,
    right: spacing.lg,
    backgroundColor: colors.headerGradientFrom,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    ...shadows.card,
  },
  toastText: { ...typography.bodySm, color: colors.white, fontWeight: '700', textAlign: 'center' },
});
