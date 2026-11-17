import { z } from 'zod';

export const sectionUpdateSchema = z.object({
  reviewStatus: z.enum(['pending', 'approved', 'revision-requested']).optional(),
  reviewComment: z.string().max(2000).optional(),
  reportText: z.string().max(100000).optional(),
  // The reviewer's own wording, kept apart from the generated text so it survives a re-compose (see prisma schema: Section.textEdits).
  textEdits: z
    .object({
      lines: z.array(z.object({ from: z.string().max(20000), to: z.string().max(20000), n: z.number().int().min(0).optional() })).max(2000).optional(),
      added: z.array(z.object({ after: z.string().max(20000), text: z.string().max(20000), n: z.number().int().min(0).optional() })).max(2000).optional(),
      blocks: z.record(z.string().max(40), z.string().max(20000)).optional(),
      stale: z.array(z.object({ from: z.string().max(20000), to: z.string().max(20000), n: z.number().int().min(0).optional() })).max(2000).optional(),
    })
    .optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  // Photo URLs (from this section's own `photos`) a reviewer has chosen to
  // leave out of the generated report. Replaces the stored list wholesale --
  // the reviewer's UI always sends the full current exclusion set.
  excludedPhotoUrls: z.array(z.string()).optional(),
  // This section's own photo list itself, replaced wholesale -- lets a
  // reviewer attach an extra photo (uploaded via POST /inspections/photos)
  // onto this section, same as excludedPhotoUrls above.
  photos: z.array(z.string()).optional(),
  // How each photo of this section prints, keyed by photo id ({ "<id>": { size: "large" } }); replaced wholesale.
  // True when `damages[].photos` is the complete, authoritative list (the photo panel moved or removed a photo): replace each defect's photos instead of merging them.
  replaceDamagePhotos: z.boolean().optional(),
  photoMeta: z.record(z.string(), z.object({ size: z.enum(['standard', 'large']) })).optional(),
  // The inspector's raw answer tree, as edited by the reviewer in the
  // Field Data editor -- same shape mobile/the inspector's own web editor
  // write. Sent together with `fields`/`reportText` above (re-derived from
  // it client-side, the same way the inspector's own save does) so the
  // report never drifts out of sync with what's recorded here.
  answers: z.record(z.string(), z.unknown()).optional(),
  // This section's damage-list entries, re-derived from `answers` the same
  // way. `photos` here is the Field Data editor's own photo control on that
  // damage's "Photos" field (the reviewer can now attach straight to it,
  // not just the section/damage sidecar) -- see updateSection for how it's
  // merged rather than replaced, since the reviewer's separate dedicated
  // photo-attach/exclude UI writes to the same `Damage.photos` column.
  // `excludedPhotoUrls` is not part of this shape -- exclusion stays
  // exclusively that separate mechanism's job.
  damages: z
    .array(
      z.object({
        type: z.string(),
        location: z.string(),
        direction: z.string(),
        widthMm: z.number(),
        lengthMm: z.number(),
        notes: z.string(),
        photos: z.array(z.string()).optional(),
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

// Rotate / crop one photo of a section. `edit` is relative to the ORIGINAL photo (so editing twice never compounds); `crop` is a box
// inside the rotated photo, as fractions of its width and height.
export const photoEditSchema = z.object({
  url: z.string().min(1).max(2000),
  edit: z.object({
    rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), w: z.number().min(0.01).max(1), h: z.number().min(0.01).max(1) }).optional(),
  }),
});
export const photoInfoSchema = z.object({ ids: z.array(z.string().uuid()).max(2000) });
export const photoOptimizeSchema = z.object({ sectionId: z.string().uuid().optional() });
export const photoUrlSchema = z.object({ url: z.string().min(1).max(2000) });

export const photoReplaceSchema = z.object({ url: z.string().min(1).max(2000), with: z.string().min(1).max(2000) });

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

export const assignSchema = z.object({ reviewerId: z.string().uuid().optional() });
export const transferRespondSchema = z.object({ accept: z.boolean() });

export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Enter their name').max(200),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  role: z.enum(['inspector', 'reviewer', 'admin']),
  phone: z.string().trim().max(50).optional(),
  region: z.string().trim().max(200).optional(),
  licenseNumber: z.string().trim().max(100).optional(),
});
export const changeRoleSchema = z.object({ role: z.enum(['inspector', 'reviewer', 'admin']), reassignToId: z.string().uuid().nullable().optional() });
export const deactivateUserSchema = z.object({ reason: z.string().trim().max(300).optional(), reassignToId: z.string().uuid().nullable().optional() });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type DeactivateUserInput = z.infer<typeof deactivateUserSchema>;
export type SectionUpdateInput = z.infer<typeof sectionUpdateSchema>;
export type DamageUpdateInput = z.infer<typeof damageUpdateSchema>;
export type InspectionUpdateInput = z.infer<typeof inspectionUpdateSchema>;
export type UserUpdateInput = z.infer<typeof userUpdateSchema>;
