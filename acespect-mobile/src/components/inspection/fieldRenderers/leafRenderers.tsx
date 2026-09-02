import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTextInput, DateField, SegmentedToggle } from '../../ui';
import { ChoiceTileGrid, TileOption } from '../ChoiceTile';
import { ChipMultiSelect, ColorSelect, FieldLabel, PillSelect, PlainTextInput } from '../fieldKit';
import { colors, radius, spacing } from '../../../theme';
import { usePhotoCapture } from '../../../hooks/usePhotoCapture';
import type { FieldRendererProps } from './types';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

export function TextFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const { prefix } = field;
  // A prefixed field (e.g. "VIC-" ahead of a job number) is never editable
  // itself -- it's rendered as static text outside the TextInput, which only
  // ever holds the suffix. `onChange` always writes prefix + suffix back, so
  // the stored value is permanently prefixed with no downstream change needed.
  const raw = asString(value);
  const suffix = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return (
    <View style={styles.block}>
      <AppTextInput
        label={field.label}
        required={field.required}
        readOnly={field.readOnly}
        placeholder={field.placeholder}
        prefix={prefix}
        value={prefix ? suffix : raw}
        onChangeText={(text) => onChange(prefix ? `${prefix}${text}` : text)}
      />
    </View>
  );
}

export function DateFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <View style={styles.block}>
      <DateField
        label={field.label}
        required={field.required}
        readOnly={field.readOnly}
        placeholder={field.placeholder}
        value={asString(value)}
        onChange={onChange}
      />
    </View>
  );
}

export function NumericFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <View style={styles.block}>
      <AppTextInput
        label={field.unit ? `${field.label} (${field.unit})` : field.label}
        required={field.required}
        readOnly={field.readOnly}
        placeholder={field.placeholder}
        keyboardType="numeric"
        value={asString(value)}
        onChangeText={onChange}
      />
    </View>
  );
}

export function TextareaFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <View style={styles.block}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <PlainTextInput
        placeholder={field.placeholder}
        value={asString(value)}
        onChangeText={onChange}
        multiline
        maxLength={field.maxLength}
      />
    </View>
  );
}

export function YesNoFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const options = (field.options?.length ? field.options : [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]).map(
    (o) => ({ value: o.value, label: o.label }),
  );
  return (
    <View style={styles.block}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <SegmentedToggle options={options} value={(value as string) ?? null} onChange={onChange} />
    </View>
  );
}

export function PillSelectFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <View style={styles.block}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <PillSelect options={field.options ?? []} value={asString(value)} onChange={onChange} />
    </View>
  );
}

export function SelectTilesFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const options: TileOption[] = (field.options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
    icon: (o.icon ?? 'help-circle-outline') as TileOption['icon'],
  }));
  return (
    <View style={styles.block}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <ChoiceTileGrid options={options} value={(value as string) ?? null} onChange={onChange} columns={3} />
    </View>
  );
}

export function ColorSelectFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  return (
    <View style={styles.block}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <ColorSelect options={field.options ?? []} value={asString(value)} onChange={onChange} />
    </View>
  );
}

export function ChipMultiSelectFieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const selected = asStringArray(value);
  const otherKey = '__other__';
  const otherValue = typeof selected.find((s) => s.startsWith(`${otherKey}:`)) === 'string'
    ? (selected.find((s) => s.startsWith(`${otherKey}:`)) as string).slice(otherKey.length + 1)
    : '';
  const baseSelected = selected.filter((s) => s !== 'other' && !s.startsWith(`${otherKey}:`)).concat(
    selected.includes('other') ? ['other'] : [],
  );

  function toggle(v: string) {
    const has = baseSelected.includes(v);
    const next = has ? baseSelected.filter((s) => s !== v) : [...baseSelected, v];
    onChange(next.filter((s) => s !== 'other').concat(next.includes('other') ? ['other'] : []).concat(
      next.includes('other') && otherValue ? [`${otherKey}:${otherValue}`] : [],
    ));
  }

  function setOther(text: string) {
    const next = baseSelected.filter((s) => !s.startsWith(`${otherKey}:`));
    onChange([...next, ...(text ? [`${otherKey}:${text}`] : [])]);
  }

  return (
    <View style={styles.block}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <ChipMultiSelect
        options={field.options ?? []}
        selected={baseSelected}
        onToggle={toggle}
        allowOther={field.allowOther}
        otherValue={otherValue}
        onOtherChange={setOther}
      />
    </View>
  );
}

/**
 * Captured URIs live in the answer tree itself (not local component state),
 * so `flattenSectionToDraft` can read them back and attribute them
 * correctly -- to the containing damage record's `photos`, or the section's
 * overall `photos`, exactly as the old hand-written screens did.
 */
export function PhotosFieldRenderer({ field, value, onChange, path }: FieldRendererProps) {
  const [busy, setBusy] = useState(false);
  const { takePhoto, pickFromLibrary } = usePhotoCapture();
  const uris = asStringArray(value);
  const sectionKey = path.join(':');

  async function add(capture: typeof takePhoto) {
    if (busy) return;
    setBusy(true);
    try {
      const shot = await capture({ sectionKey, sortOrder: uris.length, caption: field.label });
      if (shot) onChange([...uris, shot.uri]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.block}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <View style={styles.photoGrid}>
        {uris.map((uri) => (
          <Image key={uri} source={{ uri }} style={styles.photoThumb} />
        ))}
        <Pressable style={styles.photoAddBtn} onPress={() => add(takePhoto)} disabled={busy}>
          <Ionicons name="camera" size={18} color={colors.barBlue} />
        </Pressable>
        <Pressable style={styles.photoAddBtn} onPress={() => add(pickFromLibrary)} disabled={busy}>
          <Ionicons name="images" size={18} color={colors.barBlue} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.lg },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  photoAddBtn: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
