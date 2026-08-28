import { api } from './apiClient';

export type TemplateFieldType =
  | 'text' | 'textarea' | 'numeric' | 'date'
  | 'yesno'
  | 'pill-select'
  | 'select-tiles'
  | 'color-select'
  | 'chip-multiselect'
  | 'photos'
  | 'repeating-group'
  | 'damage-list';

export interface TemplateFieldOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}

/** Generalizes "hasDamage === 'yes' reveals the damages list" to any field. */
export interface FieldGate {
  fieldKey: string;
  equals: string;
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
}

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  order: number;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  unit?: string;
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
