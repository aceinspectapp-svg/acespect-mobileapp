/**
 * Design tokens — colors.
 * Extracted from the ACE SPECT login + inspection wizard mockups.
 * Keep all raw hex values here; screens/components must consume `colors`,
 * never inline hex, so re-theming is a one-file change.
 */
export const colors = {
  // Brand
  primary: '#E63329', // ACE SPECT red — CTA buttons, logo, links
  primaryDark: '#C42619',
  primaryTint: '#FCEBEA', // faint red wash (e.g. focused/pressed states)

  // Dark header gradient (login hero + wizard header)
  headerGradientFrom: '#16314E',
  headerGradientTo: '#0C1D31',

  // Surfaces
  background: '#F4F6F8', // app screen background
  surface: '#FFFFFF', // cards, inputs
  surfaceAlt: '#F3F5F7', // input fill, subtle fills

  // Text
  textPrimary: '#16243A', // headings, primary copy
  textSecondary: '#5B6B7F', // body / supporting copy
  textMuted: '#94A1B2', // placeholder, captions, disabled labels
  textOnDark: '#FFFFFF',
  textOnDarkMuted: '#AFc1D6',

  // Lines / borders
  border: '#E4E9EF',
  borderStrong: '#D4DCE5',

  // Step indicator
  stepActive: '#16243A',
  stepInactive: '#C7D0DB',
  stepLine: '#D4DCE5',

  // Inspection-type accent backgrounds (icon tiles)
  accentBlue: '#EAF1FD',
  accentBlueFg: '#2F6FED',
  accentIndigo: '#ECEDFB',
  accentIndigoFg: '#5B5BD6',
  accentGreen: '#E7F6EE',
  accentGreenFg: '#1FA463',
  accentPurple: '#F1EBFB',
  accentPurpleFg: '#7C3AED',

  // Chips / tags under cards
  chipBg: '#EEF2F7',
  chipFg: '#5B6B7F',

  // Feedback
  success: '#1FA463',
  danger: '#E63329',
  warning: '#E8A33D',

  // States
  disabledBg: '#DCE3EB',
  disabledFg: '#9AA7B5',

  // Inspection flow — blue CTA gradient + progress (distinct from red brand CTA)
  ctaBlueFrom: '#2F6FED',
  ctaBlueTo: '#16345E',

  // Green CTA gradient (e.g. "Begin Inspection" final action)
  ctaGreenFrom: '#21A95B',
  ctaGreenTo: '#157A45',
  progressTrack: '#E4E9EF',
  progressFill: '#2F6FED',

  // Info banner
  infoBg: '#EAF1FD',
  infoBorder: '#D2E1FB',
  infoFg: '#2B4C7E',

  // Section card left-accent bars
  barBlue: '#2F6FED',
  barOrange: '#E8A33D',
  barPurple: '#7C3AED',
  barGreen: '#1FA463',

  // Amber accent (weather section)
  accentOrange: '#FBEFD8',
  accentOrangeFg: '#C9832A',

  // Auto-init status rows
  statusBg: '#EAF7EF',
  statusBorder: '#CDEAD8',
  statusFg: '#1B8a52',
  statusValueFg: '#2E9E66',

  // Selectable tile (weather) selected state
  tileSelectedBg: '#EAF1FD',
  tileSelectedBorder: '#2F6FED',

  // Misc
  white: '#FFFFFF',
  black: '#000000',
  shadow: '#16243A',
} as const;

export type AppColors = typeof colors;
