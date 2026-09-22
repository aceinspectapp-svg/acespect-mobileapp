import { z } from 'zod';

export const sectionUpdateSchema = z.object({
  reviewStatus: z.enum(['pending', 'approved', 'revision-requested']).optional(),
  reviewComment: z.string().max(2000).optional(),
  reportText: z.string().max(20000).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  // Photo URLs (from this section's own `photos`) a reviewer has chosen to
  // leave out of the generated report. Replaces the stored list wholesale --
  // the reviewer's UI always sends the full current exclusion set.
  excludedPhotoUrls: z.array(z.string()).optional(),
});

// A damage record's own photo-exclusion list -- same idea as the section's,
// scoped to one crack/defect's photos. No update endpoint existed for
// damages before this; this is the smallest schema that adds one.
export const damageUpdateSchema = z.object({
  excludedPhotoUrls: z.array(z.string()).optional(),
});

export const inspectionUpdateSchema = z.object({
  status: z.enum(['draft', 'submitted', 'in-review', 'approved', 'rejected']).optional(),
  notes: z.string().max(5000).optional(),
  reviewerId: z.string().uuid().nullable().optional(),
});

// Admin editing another user's profile -- currently just the fields already
// shown in the Users table (name/phone/region) plus the inspector license
// number the reviewer pane and report cover fall back to.
export const userUpdateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phone: z.string().max(50).nullable().optional(),
  region: z.string().max(200).nullable().optional(),
  licenseNumber: z.string().max(100).nullable().optional(),
});

export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;
export type DamageUpdateInput = z.infer<typeof damageUpdateSchema>;
export type InspectionUpdateInput = z.infer<typeof inspectionUpdateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
