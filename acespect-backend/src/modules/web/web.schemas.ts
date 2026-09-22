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
  // This section's own photo list itself, replaced wholesale -- lets a
  // reviewer attach an extra photo (uploaded via POST /inspections/photos)
  // onto this section, same as excludedPhotoUrls above.
  photos: z.array(z.string()).optional(),
});

// A damage record's own photo-exclusion list -- same idea as the section's,
// scoped to one crack/defect's photos. No update endpoint existed for
// damages before this; this is the smallest schema that adds one.
export const damageUpdateSchema = z.object({
  excludedPhotoUrls: z.array(z.string()).optional(),
  // This damage record's own photo list, replaced wholesale -- lets a
  // reviewer attach a photo directly to this specific crack/defect.
  photos: z.array(z.string()).optional(),
});

export const inspectionUpdateSchema = z.object({
  status: z.enum(['draft', 'submitted', 'in-review', 'approved', 'rejected']).optional(),
  notes: z.string().max(5000).optional(),
  reviewerId: z.string().uuid().nullable().optional(),
});

export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;
export type DamageUpdateInput = z.infer<typeof damageUpdateSchema>;
export type InspectionUpdateInput = z.infer<typeof inspectionUpdateSchema>;
