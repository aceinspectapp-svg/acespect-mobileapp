/**
 * Static config for the "Description & Overview" screen (Inspection Setup · Step 2).
 * Defines the photo-capture guidance and the overview photo categories the
 * inspector works through before the detailed inspection begins.
 */

export interface PhotoGuideline {
  title: string;
  detail: string;
}

export interface OverviewPhotoCategory {
  id: string;
  label: string;
  /** Required categories count toward the "X of N required captured" total. */
  required: boolean;
}

export const PHOTO_GUIDELINES: PhotoGuideline[] = [
  { title: 'Wide-angle overview', detail: 'Capture the full elevation from the street' },
  { title: 'Mid-range context', detail: 'Show property in relation to surroundings' },
  { title: 'Close-up details', detail: 'Street number, signage, access points' },
];

export const OVERVIEW_PHOTO_CATEGORIES: OverviewPhotoCategory[] = [
  { id: 'front_elevation', label: 'Front Elevation', required: true },
  { id: 'street_number', label: 'Street Number', required: true },
  { id: 'street_view_context', label: 'Street View Context', required: true },
  { id: 'neighboring_properties', label: 'Neighboring Properties', required: true },
  { id: 'relationship_construction', label: 'Relationship to Construction Site', required: true },
  { id: 'business_signage', label: 'Business Signage (if applicable)', required: false },
];

export const REQUIRED_PHOTO_COUNT = OVERVIEW_PHOTO_CATEGORIES.filter((c) => c.required).length;

/** Recommended capture range shown alongside the required count. */
export const RECOMMENDED_PHOTO_RANGE = '4–6 photos recommended';
