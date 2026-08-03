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
  fields: z.array(templateFieldSchema).max(100).default([]),
});

export const updateTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  fields: z.array(templateFieldSchema).max(100).optional(),
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
