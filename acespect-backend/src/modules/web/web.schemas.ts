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
  // The inspector's raw answer tree, as edited by the reviewer in the
  // Field Data editor -- same shape mobile/the inspector's own web editor
  // write. Sent together with `fields`/`reportText` above (re-derived from
  // it client-side, the same way the inspector's own save does) so the
  // report never drifts out of sync with what's recorded here.
  answers: z.record(z.string(), z.unknown()).optional(),
  // This section's damage-list entries, re-derived from `answers` the same
  // way. Deliberately excludes `photos`/`excludedPhotoUrls` -- those stay
  // under the reviewer's dedicated photo-selection UI above and are never
  // touched by this path; see updateSection for how existing damage rows
  // are matched back up and preserved rather than replaced wholesale.
  damages: z
    .array(
      z.object({
        type: z.string(),
        location: z.string(),
        direction: z.string(),
        widthMm: z.number(),
        lengthMm: z.number(),
        notes: z.string(),
      }),
    )
    .optional(),
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
