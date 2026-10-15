import React from 'react';
import { StyleProp, Text, TextStyle, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

/**
 * The app labels sections with emoji (a house for Description, a brick for Walls, ...). Emoji depend on the phone's emoji font and
 * showed up as a boxed "?" instead of the picture, so each one the app uses is drawn as a vector icon instead. Anything not in the
 * table is still shown as the text it is.
 */
const ICON_FOR: Record<string, keyof typeof Ionicons.glyphMap> = {
  '🏠': 'home-outline',
  '🏚': 'home-outline',
  '🏘': 'business-outline',
  '🏢': 'business-outline',
  '🧱': 'cube-outline',
  '📝': 'create-outline',
  '🚧': 'construct-outline',
  '⚠': 'warning-outline',
  '📎': 'attach-outline',
  '🔁': 'repeat-outline',
  '🚪': 'enter-outline',
  '📏': 'resize-outline',
  '📋': 'clipboard-outline',
  '🎨': 'color-palette-outline',
  '🔌': 'flash-outline',
  '🔧': 'build-outline',
  '📈': 'trending-up-outline',
  '🪜': 'layers-outline',
  '💧': 'water-outline',
  '🏊': 'water-outline',
  '🚗': 'car-outline',
  '🛋': 'bed-outline',
  '🪵': 'leaf-outline',
  '✅': 'checkmark-circle-outline',
  '🪟': 'browsers-outline',
  '🔎': 'search-outline',
  '🚶': 'walk-outline',
  '🔒': 'lock-closed-outline',
  '⏳': 'hourglass-outline',
  '☁': 'cloud-done-outline',
};

/** An emoji with its variation selector / joiners removed, so "🏘️" and "🏘" are the same key. */
const base = (s: string) => s.replace(/[︎️‍]/g, '');

/** The characters of a string that are one emoji each (a variation selector stays with its emoji). */
const units = (s: string): string[] => s.match(/(?:[\uD800-\uDBFF][\uDC00-\uDFFF]|[^\s])[︎️]?/g) ?? [];

/** Whether every character of the text is an emoji this file can draw as an icon. */
export const isDrawableEmoji = (text: string): boolean => {
  const u = units(text);
  return u.length > 0 && u.every((c) => ICON_FOR[base(c)] !== undefined);
};

export function EmojiGlyph({ text, size = 14, color, style }: { text: string; size?: number; color: string; style?: StyleProp<TextStyle> }) {
  const parts = units(text);
  if (!isDrawableEmoji(text)) return <Text style={style}>{text}</Text>;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {parts.map((c, i) => (
        <Ionicons key={i} name={ICON_FOR[base(c)]!} size={size} color={color} />
      ))}
    </View>
  );
}
