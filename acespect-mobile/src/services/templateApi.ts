import { api } from './apiClient';
import { INSPECTION_TYPES, PROPERTY_LABELS } from '../constants/inspectionData';

export type TemplateFieldType =
  | 'text' | 'textarea' | 'numeric' | 'date'
  | 'yesno'
  | 'pill-select'
  | 'select-tiles'
  | 'color-select'
  | 'chip-multiselect'
  | 'tile-multiselect'
  | 'photos'
  | 'repeating-group'
  | 'damage-list';

export interface TemplateFieldOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
  /** For a chip-multiselect option only: selecting this one clears every
   *  other selection in the same field (e.g. "No chimney present" alongside
   *  a list of chimney defects that can't apply if there's no chimney), and
   *  selecting any other option clears this one. */
  exclusive?: boolean;
}

/** Generalizes "hasDamage === 'yes' reveals the damages list" to any field. */
export interface FieldGate {
  fieldKey: string;
  equals?: string;
  /** OR-of-many alternative to `equals` -- fires when the sibling's value is any one of these. One of equals/equalsAny is always set. */
  equalsAny?: string[];
}

export interface RepeatConfig {
  presentation: 'strip' | 'fixed-tabs' | 'nested' | 'checklist';
  fixedInstances?: { key: string; label: string }[];
  addable?: boolean;
  addButtonLabel?: string;
  minInstances?: number;
  maxInstances?: number;
  /** When set, an addable instance's card title uses that instance's answer for this itemField key instead of generic numbering. */
  titleFieldKey?: string;
  /** When set, each instance starts collapsed to just its title (newly-added ones start expanded). */
  collapsible?: boolean;
  /** When set, itemFields sharing a `sectionLetter` are grouped and opened one at a time in a full-screen view instead of rendered inline, once this chip-multiselect field has a selection. */
  categoryNav?: { selectorFieldKey: string };
  /** Singular noun for one instance ("room", "part") -- progress copy only. */
  itemNoun?: string;
  /** When set, at least one instance is required once the named sibling field's value is one of `equals` (e.g. Condition = Average/Poor requires a recorded defect). Soft validation -- same non-blocking treatment as `required` fields. */
  requireWhen?: { fieldKey: string; equals: string[] };
}

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  order: number;
  required?: boolean;
  /** Fields sharing a requiredGroup are "either/or" required -- satisfied once any one of them has an answer. Ignored unless `required` is also set. */
  requiredGroup?: string;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  unit?: string;
  /** A locked, non-editable prefix baked into a text field (e.g. "VIC-" ahead
   * of a job number). Rendered as static text the inspector can't select or
   * delete; the stored value always includes it. */
  prefix?: string;
  options?: TemplateFieldOption[];
  allowOther?: boolean;
  gate?: FieldGate;
  repeat?: RepeatConfig; // present only when type is repeating-group | damage-list
  itemFields?: TemplateField[]; // recursive sub-schema for one repeating instance
  sectionLetter?: string;
}

/**
 * Optional presentation hint. `section-nav` makes a long template render as a
 * tap-through list of its `sectionLetter` groups -- one full-screen form per
 * group -- instead of a single endless scroll. `groups` carries the per-group
 * icon/hint chrome for that list; a group with no entry still renders, just
 * without them.
 */
export interface TemplateLayout {
  mode?: 'section-nav';
  groups?: { letter: string; icon?: string; hint?: string }[];
}

export interface ActiveTemplate {
  id: string;
  inspectionType: string;
  propertyType: string;
  sectionKey: string;
  version: number;
  fields: TemplateField[];
  layout?: TemplateLayout | null;
}

/** The current published template for a profile + section. */
export async function getActiveTemplate(
  inspectionType: string,
  propertyType: string,
  sectionKey: string,
): Promise<ActiveTemplate> {
  const { data } = await api.get<{ template: ActiveTemplate }>(
    `/templates/active/${inspectionType}/${propertyType}/${sectionKey}`,
  );
  return data.template;
}

/**
 * Same as `getActiveTemplate`, but falls back to whatever was last fetched
 * for this exact profile + section (cached on-device the previous time it
 * succeeded) when the live request fails -- e.g. no signal in a basement.
 * A profile never opened before while online still has nothing to fall back
 * to; this only rescues a profile the inspector (or anyone on this device)
 * has already used at least once.
 */
export async function getActiveTemplateCached(
  inspectionType: string,
  propertyType: string,
  sectionKey: string,
): Promise<ActiveTemplate> {
  // Lazy import avoids a require cycle: offlineStorage imports this module's
  // `ActiveTemplate` type, so importing it back at module scope here would
  // create one (type-only imports are fine either way, but this keeps the
  // runtime dependency one-directional).
  const { getCachedTemplate, setCachedTemplate } = await import('./offlineStorage');
  const pinKey = `${inspectionType}:${propertyType}:${sectionKey}`;
  try {
    const template = await getActiveTemplate(inspectionType, propertyType, sectionKey);
    void setCachedTemplate(pinKey, template);
    return template;
  } catch (err) {
    const cached = await getCachedTemplate(pinKey);
    if (cached) return cached;
    throw err;
  }
}

/** One profile (inspection type + property type) with at least one section the inspector hasn't accepted the latest published version of. */
export interface TemplateProfileUpdate {
  inspectionType: string;
  propertyType: string;
  pendingSections: { sectionKey: string; currentVersion: number; newVersion: number }[];
}

/** Profiles with a published version newer than what this inspector is currently accepted onto -- drives the home-screen banner and the Template Updates screen. */
export async function getTemplateUpdates(): Promise<TemplateProfileUpdate[]> {
  const { data } = await api.get<{ updates: TemplateProfileUpdate[] }>('/templates/updates');
  return data.updates;
}

/** Accept every pending section update for one profile at once -- takes effect for inspections started AFTER this call, never an already-in-progress one. */
export async function acceptProfileTemplateUpdates(
  inspectionType: string,
  propertyType: string,
): Promise<void> {
  await api.post(`/templates/updates/${inspectionType}/${propertyType}/accept`);
}

/** Human-readable name for a profile update, e.g. "Pre-Purchase — Residential House". */
export function describeTemplateProfile(inspectionType: string, propertyType: string): string {
  const typeDef = INSPECTION_TYPES.find((t) => t.id === inspectionType);
  const propertyLabel = PROPERTY_LABELS[propertyType] ?? propertyType;
  return `${typeDef?.title ?? inspectionType} — ${propertyLabel}`;
}

/** Stable key identifying one profile's pending update -- changes if which sections/versions are pending changes, so re-showing the "new template available" alert only happens for a genuinely new update, not a repeat of one already surfaced this session. */
export function templateUpdateSignature(update: TemplateProfileUpdate): string {
  return update.pendingSections
    .map((s) => `${s.sectionKey}:${s.currentVersion}->${s.newVersion}`)
    .sort()
    .join(',');
}
