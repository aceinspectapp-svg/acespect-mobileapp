import { z } from 'zod';

// Mirrors acespect-mobile/src/constants/inspectionData.ts and
// acespect-web/src/web/constants/inspectionData.ts — kept in sync by hand,
// same convention as this codebase's other shared shapes (TemplateField
// itself is duplicated per-repo the same way).
export const INSPECTION_TYPE_IDS = [
  'dilapidation',
  'pre_purchase',
  'construction_stage',
  'investigations',
] as const;
export const PROPERTY_TYPE_IDS = [
  'residential_house',
  'apartment',
  'commercial_properties',
  'public_assets',
] as const;

const FIELD_TYPES = [
  'text',
  'textarea',
  'numeric',
  'date',
  'yesno',
  'pill-select',
  'select-tiles',
  'color-select',
  'chip-multiselect',
  'photos',
  'repeating-group',
  'damage-list',
] as const;

const templateFieldOptionSchema = z.object({
  value: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  icon: z.string().max(60).optional(),
  color: z.string().max(20).optional(),
});

const fieldGateSchema = z.object({
  fieldKey: z.string().min(1).max(120),
  equals: z.string().max(200),
});

const repeatConfigSchema = z.object({
  presentation: z.enum(['strip', 'fixed-tabs', 'nested', 'checklist']),
  fixedInstances: z
    .array(z.object({ key: z.string().min(1).max(120), label: z.string().min(1).max(200) }))
    .max(30)
    .optional(),
  addable: z.boolean().optional(),
  addButtonLabel: z.string().max(60).optional(),
  minInstances: z.number().int().min(0).optional(),
  maxInstances: z.number().int().min(1).optional(),
  // When set, an addable instance's card title uses that instance's answer
  // for this itemField key (e.g. an inspector-typed "partName") instead of
  // the generic "<Label> 1, 2, 3..." numbering.
  titleFieldKey: z.string().min(1).max(120).optional(),
  // When set, each instance card starts collapsed to just its title (new
  // instances start expanded) -- for repeating groups with many conditional
  // itemFields (e.g. a checklist-gated Part), keeping every instance fully
  // expanded at once doesn't scale.
  collapsible: z.boolean().optional(),
  // When set, itemFields carrying a `sectionLetter` are grouped by it and
  // rendered as a tap-to-open list (one full-screen form per group) instead
  // of inline, once the named chip-multiselect field has a selection. Lets
  // e.g. a "what's present here?" checklist fan out into one form per
  // selected item without dumping every selected category's fields into one
  // long scroll.
  categoryNav: z.object({ selectorFieldKey: z.string().min(1).max(120) }).optional(),
  // Singular noun for one instance ("room", "part"), used only for progress
  // copy above a collapsible list -- "3 of 11 rooms recorded".
  itemNoun: z.string().max(40).optional(),
});

const baseFieldShape = {
  key: z.string().min(1).max(120),
  label: z.string().min(1).max(200),
  type: z.enum(FIELD_TYPES),
  order: z.number().int(),
  required: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  maxLength: z.number().int().positive().optional(),
  unit: z.string().max(20).optional(),
  options: z.array(templateFieldOptionSchema).max(30).optional(),
  allowOther: z.boolean().optional(),
  gate: fieldGateSchema.optional(),
  repeat: repeatConfigSchema.optional(),
  // Despite the name (kept for backward compatibility with early single-letter
  // groupings like GarageCarport's A/B/C), this holds a full group heading
  // shown above consecutive fields sharing the same value -- see FieldListRenderer.
  sectionLetter: z.string().max(100).optional(),
};

// Recursive: repeating-group / damage-list fields nest their own itemFields.
export const templateFieldSchema: z.ZodType<TemplateField> = z.lazy(() =>
  z.object({
    ...baseFieldShape,
    itemFields: z.array(templateFieldSchema).max(80).optional(),
  }),
);

export const createTemplateSchema = z.object({
  inspectionType: z.enum(INSPECTION_TYPE_IDS),
  propertyType: z.enum(PROPERTY_TYPE_IDS),
  sectionKey: z.string().min(1).max(120),
  name: z.string().min(1).max(200),
  fields: z.array(templateFieldSchema).max(300).default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fields: z.array(templateFieldSchema).max(300).optional(),
});

export interface TemplateFieldOption {
  value: string;
  label: string;
  icon?: string;
  color?: string;
}
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
  titleFieldKey?: string;
  collapsible?: boolean;
  categoryNav?: { selectorFieldKey: string };
  itemNoun?: string;
}
export interface TemplateField {
  key: string;
  label: string;
  type: (typeof FIELD_TYPES)[number];
  order: number;
  required?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  maxLength?: number;
  unit?: string;
  options?: TemplateFieldOption[];
  allowOther?: boolean;
  gate?: FieldGate;
  repeat?: RepeatConfig;
  itemFields?: TemplateField[];
  sectionLetter?: string;
}

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
