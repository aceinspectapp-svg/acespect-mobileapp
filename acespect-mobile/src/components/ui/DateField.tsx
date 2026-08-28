import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { Button } from './Button';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const pad = (n: number) => String(n).padStart(2, '0');
/** Stored value is ISO `YYYY-MM-DD` -- unambiguous and sortable, unlike D/M vs M/D. */
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseIso(value?: string): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Shows "4 Aug 2026". Anything not stored as ISO is passed through untouched. */
function formatDisplay(value?: string): string {
  const d = parseIso(value);
  if (!d) return value ?? '';
  return `${d.getDate()} ${SHORT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Monday-first offset for the 1st of a month. */
const startOffset = (year: number, month: number) => (new Date(year, month, 1).getDay() + 6) % 7;
const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

interface DateFieldProps {
  label?: string;
  required?: boolean;
  value?: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

/**
 * Tap-to-pick date field with an in-app calendar. Deliberately not backed by a
 * native picker: this has to run in Expo Go without a custom dev build, and a
 * plain-RN calendar also themes consistently with the rest of the form.
 * The keyboard never opens -- a typed date can't be half-valid.
 */
export function DateField({ label, required, value, onChange, placeholder, readOnly }: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = parseIso(value);
  const today = new Date();
  const [cursor, setCursor] = useState(() => selected ?? today);

  function openPicker() {
    if (readOnly) return;
    setCursor(parseIso(value) ?? new Date());
    setOpen(true);
  }

  function pick(day: number) {
    onChange(toIso(new Date(cursor.getFullYear(), cursor.getMonth(), day)));
    setOpen(false);
  }

  function shiftMonth(by: number) {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + by, 1));
  }

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const cells: (number | null)[] = [
    ...Array<null>(startOffset(year, month)).fill(null),
    ...Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <View style={styles.wrapper}>
      {!!label && (
        <Text style={styles.label}>
          {label}
          {required && <Text style={styles.req}> *</Text>}
        </Text>
      )}
      <Pressable
        style={[styles.field, readOnly && styles.fieldReadOnly]}
        onPress={openPicker}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}. Opens a calendar` : 'Pick a date'}
      >
        <Text style={[styles.value, !value && styles.placeholder]} numberOfLines={1}>
          {value ? formatDisplay(value) : placeholder ?? 'Select a date'}
        </Text>
        <Ionicons name="calendar-outline" size={18} color={readOnly ? colors.textMuted : colors.barBlue} />
      </Pressable>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <SafeAreaView edges={['bottom']} style={styles.sheet}>
            <View style={styles.sheetHead}>
              <Pressable onPress={() => shiftMonth(-1)} hitSlop={10} style={styles.navBtn}>
                <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
              </Pressable>
              <Text style={styles.monthTitle}>{MONTHS[month]} {year}</Text>
              <Pressable onPress={() => shiftMonth(1)} hitSlop={10} style={styles.navBtn}>
                <Ionicons name="chevron-forward" size={20} color={colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.weekRow}>
              {WEEKDAYS.map((w) => (
                <Text key={w} style={styles.weekday}>{w}</Text>
              ))}
            </View>

            {weeks.map((week, wi) => (
              <View key={wi} style={styles.weekRow}>
                {week.map((day, di) => {
                  if (day === null) return <View key={di} style={styles.dayCell} />;
                  const date = new Date(year, month, day);
                  const isSelected = !!selected && sameDay(date, selected);
                  const isToday = sameDay(date, today);
                  return (
                    <Pressable
                      key={di}
                      style={[styles.dayCell, isSelected && styles.dayCellSelected, !isSelected && isToday && styles.dayCellToday]}
                      onPress={() => pick(day)}
                    >
                      <Text style={[styles.dayText, isSelected && styles.dayTextSelected, !isSelected && isToday && styles.dayTextToday]}>
                        {day}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <View style={styles.sheetFooter}>
              <Button label="Clear" variant="outline" fitContent onPress={() => { onChange(''); setOpen(false); }} />
              <Button
                label="Today"
                variant="primaryGradient"
                style={styles.footerGrow}
                onPress={() => { onChange(toIso(new Date())); setOpen(false); }}
              />
            </View>
            <Pressable onPress={() => setOpen(false)} style={styles.cancel} hitSlop={8}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { width: '100%' },
  label: { ...typography.label, color: colors.textSecondary, marginBottom: spacing.sm },
  req: { color: colors.danger, fontWeight: '700' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
  },
  fieldReadOnly: { borderStyle: 'dashed' },
  value: { flex: 1, ...typography.body, color: colors.textPrimary },
  placeholder: { color: colors.textMuted },

  backdrop: { flex: 1, backgroundColor: 'rgba(15,29,53,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  navBtn: {
    width: 36, height: 36, borderRadius: radius.sm,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border,
  },
  monthTitle: { ...typography.label, color: colors.textPrimary, fontWeight: '700' },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  weekday: { ...typography.caption, color: colors.textMuted, width: 40, textAlign: 'center', fontWeight: '700' },
  dayCell: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  dayCellSelected: { backgroundColor: colors.barBlue },
  dayCellToday: { borderWidth: 1, borderColor: colors.barBlue },
  dayText: { ...typography.bodySm, color: colors.textPrimary },
  dayTextSelected: { color: colors.white, fontWeight: '700' },
  dayTextToday: { color: colors.barBlue, fontWeight: '700' },
  sheetFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  footerGrow: { flex: 1 },
  cancel: { alignItems: 'center', paddingVertical: spacing.md },
  cancelText: { ...typography.bodySm, color: colors.textMuted, fontWeight: '600' },
});
