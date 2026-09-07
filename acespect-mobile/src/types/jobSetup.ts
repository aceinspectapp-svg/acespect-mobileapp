/**
 * Types for the Job Information setup screen (Inspection Setup · Step 1 of 2).
 */
import { InspectionDraftSelection } from './inspection';

export type WeatherId =
  | 'sunny'
  | 'overcast'
  | 'dry'
  | 'intermittent_showers'
  | 'rain'
  | 'other';

export type PropertyUse = 'yes' | 'no';

/** Pre-loaded job details (from the admin platform). Editable on-site. */
export interface JobDetails {
  jobNumber: string;
  inspectionDate: string; // ISO-ish display string for now
  clientName: string;
  inspectionAddress: string;
  assignedInspector: string; // read-only (admin-assigned)
  gpsConfirmed: boolean;
}

/** Auto-initialized system status captured when the inspection begins. */
export interface SystemStatus {
  startedAt: string;
  gpsLocation: string;
  photoSequence: string;
  cloudSync: 'Connected' | 'Offline';
  offlineSave: 'Active' | 'Inactive';
}

/** Everything the Job Information step produces, handed to step 2. */
export interface JobSetupData {
  selection: InspectionDraftSelection;
  details: JobDetails;
  // Display-only summary string (e.g. "Sunny, Windy") -- Weather is a
  // multi-select on the template now, so this is a joined string rather
  // than a single WeatherId. The full per-option answer lives in the
  // draft's own answer tree (job-info section), which is what anything
  // other than this one summary card should read.
  weather: string;
  usedAsBusiness: PropertyUse;
  systemStatus: SystemStatus;
}
