import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { AppTextInput, DateField, SegmentedToggle } from '../../ui';
import { ChoiceTileGrid, ChoiceTileMultiGrid, TileOption } from '../ChoiceTile';
import { ChipMultiSelect, ColorSelect, FieldLabel, PillSelect, PlainTextInput } from '../fieldKit';
import { colors, radius, spacing } from '../../../theme';
import { usePhotoCapture } from '../../../hooks/usePhotoCapture';
import { PhotoAnnotator } from '../PhotoAnnotator';
import type { AnswerValue, FieldRendererProps } from './types';

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');
const asStringArray = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

/** Every leaf renderer's outer wrapper -- adds the red outline when `missing` (a required, currently-unfilled field, once the inspector has tried to leave) is true. */
function blockStyle(missing?: boolean) {
  return [styles.block, missing && styles.missingBlock];
}

export function TextFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  const { prefix } = field;
  // A prefixed field (e.g. "VIC-" ahead of a job number) is never editable
  // itself -- it's rendered as static text outside the TextInput, which only
  // ever holds the suffix. `onChange` always writes prefix + suffix back, so
  // the stored value is permanently prefixed with no downstream change needed.
  const raw = asString(value);
  const suffix = prefix && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return (
    <View style={blockStyle(missing)}>
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

export function DateFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  return (
    <View style={blockStyle(missing)}>
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

export function NumericFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  return (
    <View style={blockStyle(missing)}>
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

export function TextareaFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  return (
    <View style={blockStyle(missing)}>
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

export function YesNoFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  const options = (field.options?.length ? field.options : [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]).map(
    (o) => ({ value: o.value, label: o.label }),
  );
  return (
    <View style={blockStyle(missing)}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <SegmentedToggle options={options} value={(value as string) ?? null} onChange={onChange} />
    </View>
  );
}

export function PillSelectFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  return (
    <View style={blockStyle(missing)}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <PillSelect options={field.options ?? []} value={asString(value)} onChange={onChange} allowOther={field.allowOther} />
    </View>
  );
}

export function SelectTilesFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  const options: TileOption[] = (field.options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
    icon: (o.icon ?? 'help-circle-outline') as TileOption['icon'],
  }));
  return (
    <View style={blockStyle(missing)}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <ChoiceTileGrid options={options} value={(value as string) ?? null} onChange={onChange} columns={3} />
    </View>
  );
}

export function ColorSelectFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  return (
    <View style={blockStyle(missing)}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <ColorSelect options={field.options ?? []} value={asString(value)} onChange={onChange} />
    </View>
  );
}

/**
 * Shared multi-select toggle semantics for chip- and tile-multiselect: an
 * `exclusive` option (e.g. "No chimney present" sitting alongside a list of
 * actual defects) can't logically coexist with any other selection --
 * selecting it clears every other pick, and picking anything else drops
 * whichever exclusive option was selected. The `__other__:<text>` entry
 * carries the gated "Other, specify" companion field's value alongside the
 * plain `other` selection itself.
 */
function useMultiSelectToggle(field: FieldRendererProps['field'], value: AnswerValue, onChange: (v: AnswerValue) => void) {
  const selected = asStringArray(value);
  const otherKey = '__other__';
  const otherValue = typeof selected.find((s) => s.startsWith(`${otherKey}:`)) === 'string'
    ? (selected.find((s) => s.startsWith(`${otherKey}:`)) as string).slice(otherKey.length + 1)
    : '';
  const baseSelected = selected.filter((s) => s !== 'other' && !s.startsWith(`${otherKey}:`)).concat(
    selected.includes('other') ? ['other'] : [],
  );

  const isExclusive = (v: string) => !!field.options?.find((o) => o.value === v)?.exclusive;

  function toggle(v: string) {
    const has = baseSelected.includes(v);
    let next: string[];
    if (has) {
      next = baseSelected.filter((s) => s !== v);
    } else if (isExclusive(v)) {
      next = [v];
    } else {
      next = [...baseSelected.filter((s) => !isExclusive(s)), v];
    }
    onChange(next.filter((s) => s !== 'other').concat(next.includes('other') ? ['other'] : []).concat(
      next.includes('other') && otherValue ? [`${otherKey}:${otherValue}`] : [],
    ));
  }

  function setOther(text: string) {
    const next = baseSelected.filter((s) => !s.startsWith(`${otherKey}:`));
    onChange([...next, ...(text ? [`${otherKey}:${text}`] : [])]);
  }

  return { baseSelected, otherValue, toggle, setOther };
}

export function ChipMultiSelectFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  const { baseSelected, otherValue, toggle, setOther } = useMultiSelectToggle(field, value, onChange);

  return (
    <View style={blockStyle(missing)}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <ChipMultiSelect
        options={(field.options ?? []).map((o) => ({ ...o, icon: o.icon as keyof typeof Ionicons.glyphMap | undefined }))}
        selected={baseSelected}
        onToggle={toggle}
        allowOther={field.allowOther}
        otherValue={otherValue}
        onOtherChange={setOther}
      />
    </View>
  );
}

/** Same tile-card look as the old single-select weather tiles, but more than one can be active at once. */
export function TileMultiSelectFieldRenderer({ field, value, onChange, missing }: FieldRendererProps) {
  const { baseSelected, otherValue, toggle, setOther } = useMultiSelectToggle(field, value, onChange);
  const options: TileOption[] = (field.options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
    icon: (o.icon ?? 'help-circle-outline') as TileOption['icon'],
  }));

  return (
    <View style={blockStyle(missing)}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <ChoiceTileMultiGrid options={options} selected={baseSelected} onToggle={toggle} columns={3} />
      {field.allowOther && baseSelected.includes('other') && (
        <PlainTextInput
          placeholder="Please specify"
          value={otherValue}
          onChangeText={setOther}
          style={{ marginTop: spacing.sm }}
        />
      )}
    </View>
  );
}

/**
 * Captured URIs live in the answer tree itself (not local component state),
 * so `flattenSectionToDraft` can read them back and attribute them
 * correctly -- to the containing damage record's `photos`, or the section's
 * overall `photos`, exactly as the old hand-written screens did.
 */
export function PhotosFieldRenderer({ field, value, onChange, path, missing }: FieldRendererProps) {
  const [busy, setBusy] = useState(false);
  const { takePhoto, pickFromLibrary } = usePhotoCapture();
  const uris = asStringArray(value);
  const sectionKey = path.join(':');
  // The photo currently open in the annotator, if any -- null closes it.
  const [annotating, setAnnotating] = useState<string | null>(null);

  // The phone's own camera app owns its capture/confirm screen -- there's no
  // way for this app to offer annotation before that "tick", so the earliest
  // possible moment is the instant the photo lands back here. A camera shot
  // is always exactly one photo, so jump straight into annotating it instead
  // of making the inspector tap its thumbnail again afterward.
  async function onTakePhoto() {
    if (busy) return;
    setBusy(true);
    try {
      const shots = await takePhoto({ sectionKey, sortOrder: uris.length, caption: field.label });
      if (shots?.length) {
        const newUri = shots[0]!.uri;
        onChange([...uris, newUri]);
        setAnnotating(newUri);
      }
    } finally {
      setBusy(false);
    }
  }

  // A library pick can return several photos at once -- auto-opening the
  // annotator for every one of them would be more annoying than helpful, so
  // this path stays tap-to-annotate from the grid, same as any other photo.
  async function onPickFromLibrary() {
    if (busy) return;
    setBusy(true);
    try {
      const shots = await pickFromLibrary({ sectionKey, sortOrder: uris.length, caption: field.label });
      if (shots?.length) onChange([...uris, ...shots.map((s) => s.uri)]);
    } finally {
      setBusy(false);
    }
  }

  // Saving replaces the tapped photo in place with the flattened, marked-up
  // version -- same position in the array, so it stays wherever it already
  // was relative to the others.
  function onAnnotated(newUri: string) {
    onChange(uris.map((u) => (u === annotating ? newUri : u)));
    setAnnotating(null);
  }

  return (
    <View style={blockStyle(missing)}>
      <FieldLabel required={field.required}>{field.label}</FieldLabel>
      <View style={styles.photoGrid}>
        {uris.map((uri) => (
          <Pressable key={uri} onPress={() => setAnnotating(uri)} accessibilityLabel="Mark up photo">
            <Image source={{ uri }} style={styles.photoThumb} />
            <View style={styles.photoThumbBadge}>
              <Ionicons name="create-outline" size={12} color={colors.white} />
            </View>
          </Pressable>
        ))}
        <Pressable style={styles.photoAddBtn} onPress={onTakePhoto} disabled={busy}>
          <Ionicons name="camera" size={18} color={colors.barBlue} />
        </Pressable>
        <Pressable style={styles.photoAddBtn} onPress={onPickFromLibrary} disabled={busy}>
          <Ionicons name="images" size={18} color={colors.barBlue} />
        </Pressable>
      </View>
      <PhotoAnnotator
        visible={annotating !== null}
        uri={annotating}
        onCancel={() => setAnnotating(null)}
        onSave={onAnnotated}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { marginBottom: spacing.lg },
  // See `blockStyle()` above.
  missingBlock: {
    borderWidth: 1.5,
    borderColor: colors.danger,
    borderRadius: radius.md,
    padding: spacing.sm,
  },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  photoThumb: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt },
  photoThumbBadge: {
    position: 'absolute',
    right: 2,
    bottom: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
