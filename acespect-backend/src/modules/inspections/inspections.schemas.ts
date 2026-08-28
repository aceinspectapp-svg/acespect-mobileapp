import { z } from 'zod';

/** A defect/crack within a section. Photos are public URLs (from /photos upload). */
const damageSchema = z.object({
  type: z.string().trim().min(1).max(120),
  location: z.string().max(500).default(''),
  direction: z.string().max(120).default(''),
  widthMm: z.number().nonnegative().default(0),
  lengthMm: z.number().nonnegative().default(0),
  notes: z.string().max(2000).default(''),
  photos: z.array(z.string().url()).max(50).default([]),
  order: z.number().int().default(0),
});

/** One filled-in section of the inspection form. */
const sectionSchema = z.object({
  key: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(200),
  icon: z.string().max(16).default(''),
  order: z.number().int().default(0),
  status: z.enum(['complete', 'partial', 'pending']).default('pending'),
  reportText: z.string().max(20000).default(''),
  fields: z.record(z.string(), z.unknown()).default({}),
  /** Raw un-flattened answer tree, kept so the section can be reopened for editing. */
  answers: z.record(z.string(), z.unknown()).optional(),
  photos: z.array(z.string().url()).max(200).default([]),
  damages: z.array(damageSchema).max(200).default([]),
});

/**
 * Structured inspection submission from the mobile app. Top-level job fields +
 * the filled sections. `payload` is kept optional for the AI review pipeline.
 */
export const submitInspectionSchema = z.object({
  inspectionType: z.string().trim().min(1, 'inspectionType is required').max(120),
  propertyType: z.string().trim().min(1, 'propertyType is required').max(120),

  jobNo: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  suburb: z.string().max(200).optional(),
  client: z.string().max(300).optional(),
  date: z.string().max(40).optional(), // ISO date; defaults to now
  notes: z.string().max(5000).optional(),
  overallProgress: z.number().int().min(0).max(100).optional(),

  sections: z.array(sectionSchema).max(50).default([]),

  // Legacy AI-pipeline slots (optional).
  payload: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Editing a draft: every field optional, and `sections` (when given) replaces
 * the stored set wholesale -- the mobile form always sends the complete picture
 * rather than a partial patch.
 */
export const updateInspectionSchema = z.object({
  jobNo: z.string().max(120).optional(),
  address: z.string().max(300).optional(),
  suburb: z.string().max(200).optional(),
  client: z.string().max(300).optional(),
  date: z.string().max(40).optional(),
  notes: z.string().max(5000).optional(),
  overallProgress: z.number().int().min(0).max(100).optional(),
  sections: z.array(sectionSchema).max(50).optional(),
});

export type SubmitInspectionInput = z.infer<typeof submitInspectionSchema>;
export type UpdateInspectionInput = z.infer<typeof updateInspectionSchema>;
export type SubmitSectionInput = z.infer<typeof sectionSchema>;
