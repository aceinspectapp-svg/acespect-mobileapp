/**
 * Design tokens — typography.
 * Uses the platform system font for the first step (no custom font loading yet).
 * Swap `fontFamily` here once Inter/your brand font is wired via expo-font.
 */
import { TextStyle } from 'react-native';

type Variant =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'sectionTitle'
  | 'body'
  | 'bodySm'
  | 'label'
  | 'caption'
  | 'button'
  | 'overline';

export const typography: Record<Variant, TextStyle> = {
  h1: { fontSize: 28, fontWeight: '800', letterSpacing: 0.2 },
  h2: { fontSize: 22, fontWeight: '700' },
  h3: { fontSize: 17, fontWeight: '700' },
  sectionTitle: { fontSize: 13, fontWeight: '700', letterSpacing: 0.6 },
  body: { fontSize: 15, fontWeight: '400' },
  bodySm: { fontSize: 13, fontWeight: '400' },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
  caption: { fontSize: 12, fontWeight: '400' },
  button: { fontSize: 16, fontWeight: '700', letterSpacing: 0.8 },
  overline: { fontSize: 11, fontWeight: '700', letterSpacing: 1.5 },
};
