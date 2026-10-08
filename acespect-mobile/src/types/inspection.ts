/**
 * Domain types for the inspection wizard.
 *
 * NOTE: For the first step these power static reference data. Once the backend
 * is in, inspection types & property types become server-synced reference tables
 * (see project foundation) and these interfaces become the API/WatermelonDB
 * model shape — so they're defined deliberately, not just for the UI.
 */

export type InspectionTypeId =
  | 'dilapidation'
  | 'pre_purchase'
  | 'construction_stage'
  | 'investigations';

export type ConstructionStageId = 'pre_pour' | 'slab' | 'framework' | 'lock_up' | 'fixing' | 'pci' | 'slab_frame' | 'lock_fix';

export type PropertyTypeId =
  | 'residential_house'
  | 'apartment'
  | 'commercial_properties'
  | 'public_assets';

/** Visual accent used for an inspection type's icon tile. */
export type AccentKey = 'blue' | 'indigo' | 'green' | 'purple';

/** Name of an Ionicons / MaterialCommunityIcons glyph. */
export type IconName = string;

export interface InspectionType {
  id: InspectionTypeId;
  title: string;
  subtitle: string; // e.g. "Condition Report"
  icon: IconName;
  iconSet: 'ion' | 'mc';
  accent: AccentKey;
  /** Property categories this inspection type applies to. */
  applicableProperties: PropertyTypeId[];
  /** Extra descriptive tags shown as chips (beyond property categories). */
  tags?: string[];
}

export interface PropertyType {
  id: PropertyTypeId;
  title: string;
  icon: IconName;
  iconSet: 'ion' | 'mc';
}

/** The selection the wizard produces and hands to the next step. */
export interface InspectionDraftSelection {
  inspectionTypeId: InspectionTypeId;
  propertyTypeId: PropertyTypeId;
  /** Construction Stage inspections only: which of the six stages this one is. */
  stageId?: ConstructionStageId;
}
