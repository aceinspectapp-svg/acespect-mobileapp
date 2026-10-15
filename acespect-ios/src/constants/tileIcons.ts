/**
 * The icon a choice tile shows. A template may give each option an Ionicons name; when it does not (the Apartment weather
 * options Fine / Partly Cloudy / Light Rain have none), the icon is picked from the option's wording instead of the "?" fallback.
 */
const BY_WORD: [RegExp, string][] = [
  [/partly|part cloud|intermittent|sunny (spell|interval)/i, 'partly-sunny-outline'],
  [/light rain|drizzle|shower/i, 'rainy-outline'],
  [/rain|wet|storm/i, 'rainy-outline'],
  [/overcast|cloud/i, 'cloudy-outline'],
  [/fine|sunny|clear|fair/i, 'sunny-outline'],
  [/dry/i, 'thermometer-outline'],
  [/other/i, 'ellipsis-horizontal-circle-outline'],
];

export function tileIconFor(label: string, icon?: string | null): string {
  if (icon) return icon;
  for (const [re, name] of BY_WORD) if (re.test(label)) return name;
  return 'help-circle-outline';
}
