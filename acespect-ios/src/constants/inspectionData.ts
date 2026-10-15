/**
 * Static reference data for the inspection wizard.
 * Mirrors the mockup. Will be replaced by synced reference tables from the
 * backend later — kept in one place so that swap is trivial.
 */
import { InspectionType, PropertyType } from '../types/inspection';

export const PROPERTY_TYPES: PropertyType[] = [
  { id: 'residential_house', title: 'Residential House', icon: 'home-outline', iconSet: 'ion' },
  { id: 'apartment', title: 'Apartment', icon: 'business-outline', iconSet: 'ion' },
  { id: 'commercial_properties', title: 'Commercial Properties', icon: 'storefront-outline', iconSet: 'ion' },
  { id: 'public_assets', title: 'Public Assets', icon: 'layers-outline', iconSet: 'ion' },
];

/** Quick lookup for rendering property labels as chips. */
export const PROPERTY_LABELS: Record<string, string> = PROPERTY_TYPES.reduce(
  (acc, p) => ({ ...acc, [p.id]: p.title }),
  {} as Record<string, string>,
);

export const INSPECTION_TYPES: InspectionType[] = [
  {
    id: 'dilapidation',
    title: 'Dilapidation',
    subtitle: 'Condition Report',
    icon: 'document-text-outline',
    iconSet: 'ion',
    accent: 'indigo',
    applicableProperties: [
      'residential_house',
      'apartment',
      'commercial_properties',
      'public_assets',
    ],
  },
  {
    id: 'pre_purchase',
    title: 'Pre-Purchase',
    subtitle: 'Building Inspection',
    icon: 'home-outline',
    iconSet: 'ion',
    accent: 'blue',
    applicableProperties: ['residential_house', 'apartment', 'commercial_properties'],
  },
  {
    id: 'construction_stage',
    title: 'Construction Stage',
    subtitle: 'Stage Inspection',
    icon: 'layers-outline',
    iconSet: 'ion',
    accent: 'green',
    applicableProperties: ['residential_house', 'apartment'],
  },
  {
    id: 'investigations',
    title: 'Investigations',
    subtitle: 'Expert Opinion',
    icon: 'flask-outline',
    iconSet: 'ion',
    accent: 'purple',
    applicableProperties: ['residential_house', 'apartment', 'commercial_properties'],
    tags: ['Defect Investigation', 'Scope of Work for Rectification', 'Cost Estimation'],
  },
];

export const INSPECTION_TYPE_BY_ID: Record<string, InspectionType> = INSPECTION_TYPES.reduce(
  (acc, t) => ({ ...acc, [t.id]: t }),
  {} as Record<string, InspectionType>,
);
