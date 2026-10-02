import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../../theme';
import { ChipMultiSelect, FieldLabel, PlainTextInput } from '../inspection/fieldKit';
import { Checkbox, DateField } from '../ui';
import { PickerSheet } from './PickerSheet';
import { SpecField } from '../../types/qc';

export interface RefOption {
  id: string;
  label: string;
}

interface SpecFieldsProps {
  fields: SpecField[];
  values: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** Options for reference fields, keyed by the spec entity they point at (E03 trade companies, E19 trade categories). */
  refOptions?: Record<string, RefOption[]>;
  errors?: Record<string, string>;
}

/** Fields the renderer shows: user-editable, not supplied by the server, and not a file (the screen handles photos). */
export function visibleFields(fields: SpecField[]): SpecField[] {
  return fields.filter((f) => !f.system && !f.hidden && f.kind !== 'file' && f.kind !== 'files');
}

function isRequired(f: SpecField, values: Record<string, unknown>): boolean {
  if (f.req === 'M') return true;
  if (f.req === 'C' && f.requiredWhen) {
    const driver = values[f.requiredWhen.field];
    return typeof driver === 'string' && f.requiredWhen.in.includes(driver);
  }
  return false;
}

/** Drops empty values so the server treats them as absent. */
export function cleanValues(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function SpecFields({ fields, values, onChange, refOptions = {}, errors = {} }: SpecFieldsProps) {
  const set = (key: string, v: unknown) => onChange({ ...values, [key]: v });
  return (
    <View style={styles.stack}>
      {visibleFields(fields).map((f) => (
        <View key={f.key}>
          {f.kind !== 'bool' && <FieldLabel required={isRequired(f, values)}>{f.label}</FieldLabel>}
          <Field f={f} v={values[f.key]} onChange={(v) => set(f.key, v)} options={f.ref ? refOptions[f.ref] : undefined} />
          {errors[f.key] && <Text style={styles.error}>{errors[f.key]}</Text>}
        </View>
      ))}
    </View>
  );
}

function SelectRow({ title, value, options, onPick }: { title: string; value: string; options: RefOption[]; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = options.find((o) => o.id === value)?.label;
  return (
    <>
      <Pressable style={styles.selectRow} onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={title}>
        <Text style={[styles.selectText, !label && styles.placeholder]} numberOfLines={1}>{label ?? 'Select…'}</Text>
        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>
      <PickerSheet visible={open} title={title} onClose={() => setOpen(false)}>
        {options.map((o) => (
          <Pressable
            key={o.id}
            style={styles.option}
            onPress={() => {
              onPick(o.id);
              setOpen(false);
            }}
          >
            <Text style={styles.optionText}>{o.label}</Text>
            {o.id === value && <Ionicons name="checkmark" size={18} color={colors.barBlue} />}
          </Pressable>
        ))}
      </PickerSheet>
    </>
  );
}

function Field({ f, v, onChange, options }: { f: SpecField; v: unknown; onChange: (v: unknown) => void; options?: RefOption[] }) {
  const str = typeof v === 'string' || typeof v === 'number' ? String(v) : '';
  switch (f.kind) {
    case 'select':
      return <SelectRow title={f.label} value={str} options={(f.options ?? []).map((o) => ({ id: o, label: o }))} onPick={onChange} />;
    case 'ref':
      return <SelectRow title={f.label} value={str} options={options ?? []} onPick={onChange} />;
    case 'multiselect': {
      const picked = Array.isArray(v) ? (v as string[]) : [];
      return (
        <ChipMultiSelect
          options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
          selected={picked}
          onToggle={(o) => onChange(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])}
        />
      );
    }
    case 'refs': {
      const picked = Array.isArray(v) ? (v as string[]) : [];
      return (
        <ChipMultiSelect
          options={(options ?? []).map((o) => ({ value: o.id, label: o.label }))}
          selected={picked}
          onToggle={(o) => onChange(picked.includes(o) ? picked.filter((x) => x !== o) : [...picked, o])}
        />
      );
    }
    case 'bool':
      return <Checkbox checked={v === true} onChange={onChange} label={f.label + (f.req === 'M' ? ' *' : '')} />;
    case 'date':
      return <DateField label="" value={str} onChange={onChange} placeholder="Select a date" />;
    case 'int':
    case 'decimal':
    case 'currency':
      return <PlainTextInput value={str} keyboardType="numeric" onChangeText={(t) => onChange(t === '' ? '' : Number(t))} />;
    case 'longtext':
      return <PlainTextInput value={str} multiline onChangeText={onChange} maxLength={f.max ?? 4000} />;
    case 'phone':
    case 'email':
    case 'text':
    default:
      return <PlainTextInput value={str} onChangeText={onChange} maxLength={f.max} />;
  }
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  error: { ...typography.caption, color: colors.danger, marginTop: 4 },
  selectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  selectText: { ...typography.body, color: colors.textPrimary, flex: 1 },
  placeholder: { color: colors.textMuted },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionText: { ...typography.body, color: colors.textPrimary, flex: 1 },
});
