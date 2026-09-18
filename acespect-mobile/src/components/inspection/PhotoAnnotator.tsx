import React, { useRef, useState } from 'react';
import {
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import { captureRef } from 'react-native-view-shot';
import { colors, radius, spacing, typography } from '../../theme';

const PHOTO_DIR = 'inspection-photos';
const STROKE_WIDTH = 5;
const MARK_COLORS = [
  { value: colors.danger, label: 'Red' },
  { value: colors.warning, label: 'Yellow' },
  { value: colors.white, label: 'White' },
] as const;

interface Stroke {
  color: string;
  d: string;
}

/** Move a view-shot temp capture into stable document storage, same convention as usePhotoCapture.ts. */
function persistAnnotated(tempUri: string): string {
  const dir = new Directory(Paths.document, PHOTO_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `${Crypto.randomUUID()}.jpg`);
  new File(tempUri).copy(dest);
  return dest.uri;
}

function deleteLocalFile(uri: string) {
  try {
    new File(uri).delete();
  } catch {
    // Already gone, or not a local file (e.g. a remote URL on a re-annotated already-synced photo) -- fine either way.
  }
}

/**
 * Full-screen freehand annotation over a captured photo -- point at a
 * defect by drawing on it directly, same touch-drawing technique as the
 * inspector-declaration signature pad. Saving flattens the drawing into the
 * photo itself (via a view screenshot, not a separate overlay file) and
 * replaces the original locally; there's no separate "annotated version" to
 * keep track of downstream, callers just get a new URI back.
 */
export function PhotoAnnotator({
  visible,
  uri,
  onCancel,
  onSave,
}: {
  visible: boolean;
  uri: string | null;
  onCancel: () => void;
  onSave: (newUri: string) => void;
}) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [color, setColor] = useState<string>(MARK_COLORS[0].value);
  const [saving, setSaving] = useState(false);
  const currentRef = useRef('');
  const [current, setCurrent] = useState('');
  const captureViewRef = useRef<View>(null);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentRef.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)} L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        setCurrent(currentRef.current);
      },
      onPanResponderMove: (e) => {
        const { locationX, locationY } = e.nativeEvent;
        currentRef.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
        setCurrent(currentRef.current);
      },
      onPanResponderRelease: () => {
        const stroke = currentRef.current;
        currentRef.current = '';
        setCurrent('');
        if (stroke) setStrokes((prev) => [...prev, { color, d: stroke }]);
      },
    }),
  ).current;

  function reset() {
    setStrokes([]);
    currentRef.current = '';
    setCurrent('');
    setColor(MARK_COLORS[0].value);
  }

  function handleCancel() {
    reset();
    onCancel();
  }

  function undo() {
    setStrokes((prev) => prev.slice(0, -1));
  }

  async function handleSave() {
    if (!uri || saving) return;
    if (strokes.length === 0) {
      // Nothing drawn -- nothing to flatten, just leave the photo as-is.
      handleCancel();
      return;
    }
    setSaving(true);
    try {
      const tempUri = await captureRef(captureViewRef, { format: 'jpg', quality: 0.9 });
      const finalUri = persistAnnotated(tempUri);
      deleteLocalFile(uri);
      reset();
      onSave(finalUri);
    } catch (err) {
      console.warn('[PhotoAnnotator] failed to save annotation', err);
    } finally {
      setSaving(false);
    }
  }

  if (!uri) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={handleCancel}>
      <View style={styles.root}>
        <SafeAreaView style={styles.safe}>
          <View style={styles.topBar}>
            <Pressable onPress={handleCancel} style={styles.iconBtn} hitSlop={8} accessibilityLabel="Cancel">
              <Ionicons name="close" size={22} color={colors.white} />
            </Pressable>
            <Text style={styles.title}>Mark up photo</Text>
            <Pressable onPress={handleSave} style={styles.iconBtn} hitSlop={8} disabled={saving} accessibilityLabel="Save">
              <Ionicons name={saving ? 'hourglass-outline' : 'checkmark'} size={22} color={colors.white} />
            </Pressable>
          </View>

          <View style={styles.canvasWrap}>
            <View ref={captureViewRef} collapsable={false} style={styles.canvas}>
              <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" />
              <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
                <Svg style={StyleSheet.absoluteFill}>
                  {strokes.map((s, i) => (
                    <Path key={i} d={s.d} stroke={s.color} strokeWidth={STROKE_WIDTH} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ))}
                  {current ? (
                    <Path d={current} stroke={color} strokeWidth={STROKE_WIDTH} fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  ) : null}
                </Svg>
              </View>
            </View>
          </View>

          <View style={styles.toolbar}>
            <View style={styles.colorRow}>
              {MARK_COLORS.map((c) => (
                <Pressable
                  key={c.value}
                  onPress={() => setColor(c.value)}
                  accessibilityLabel={c.label}
                  style={[styles.swatch, { backgroundColor: c.value }, color === c.value && styles.swatchActive]}
                />
              ))}
            </View>
            <View style={styles.actionsRow}>
              <Pressable onPress={undo} disabled={strokes.length === 0} style={styles.actionBtn}>
                <Ionicons name="arrow-undo-outline" size={16} color={strokes.length === 0 ? colors.textOnDarkMuted : colors.white} />
                <Text style={[styles.actionText, strokes.length === 0 && styles.actionTextDisabled]}>Undo</Text>
              </Pressable>
              <Pressable onPress={reset} disabled={strokes.length === 0} style={styles.actionBtn}>
                <Ionicons name="trash-outline" size={16} color={strokes.length === 0 ? colors.textOnDarkMuted : colors.white} />
                <Text style={[styles.actionText, strokes.length === 0 && styles.actionTextDisabled]}>Clear</Text>
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  safe: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...typography.body, fontWeight: '700', color: colors.white },
  canvasWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  canvas: { width: '100%', height: '100%' },
  toolbar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  colorRow: { flexDirection: 'row', gap: spacing.sm },
  swatch: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)' },
  swatchActive: { borderColor: colors.white },
  actionsRow: { flexDirection: 'row', gap: spacing.lg },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { ...typography.caption, color: colors.white, fontWeight: '600' },
  actionTextDisabled: { color: colors.textOnDarkMuted },
});
