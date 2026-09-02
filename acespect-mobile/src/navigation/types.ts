import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { InspectionDraftSelection } from '../types/inspection';
import { JobSetupData } from '../types/jobSetup';

/** Screens available before authentication. */
export type AuthStackParamList = {
  Login: undefined;
  SignUp: undefined;
  // ForgotPassword lands here next.
};

/** Screens available once authenticated. */
export type AppStackParamList = {
  SelectInspectionType: undefined;
  // Post-Dilapidation jobs admin has pushed to the signed-in inspector.
  AssignedJobs: undefined;
  // Inspection Setup · Step 1 of 2 — receives the wizard's selection.
  // `fromHub`: opened from the Inspection Sections hub to review/edit an
  // already-started inspection, rather than as the first screen of a brand
  // new one -- changes what "Next" does (return to the hub vs. continue the
  // linear setup into Step 2).
  JobInformation: { selection: InspectionDraftSelection; fromHub?: boolean };
  // Inspection Setup · Step 2 of 2 — receives the completed job setup.
  InspectionSetupStep2: { data: JobSetupData };
  // Inspection Sections hub — landing screen after setup. `completedId` is set
  // when a finished section navigates back to update progress.
  InspectionSections: { data: JobSetupData; completedId?: string };
  // Individual section screens.
  DrivewaySection: undefined;
  PavingPaths: undefined;
  Fences: undefined;
  RetainingWalls: undefined;
  GarageCarport: undefined;
  Elevations: undefined;
  RoofChimneys: undefined;
  PoolSpa: undefined;
  InternalAreas: undefined;
  NotesPostProject: undefined;
  // "Add extra structure / room" — inspector names a one-off section not
  // covered by the fixed list (a pergola, granny flat, spare room, etc).
  AddCustomSection: undefined;
  // Renders the shared generic template for one inspector-added custom
  // section. `sectionKey` is that instance's own unique draft key;
  // `sectionName` is what the inspector typed for it.
  CustomSection: { sectionKey: string; sectionName: string };
  // Final overview — receives the live completion map + job setup data.
  ReportSummary: { completed: Record<string, boolean>; data: JobSetupData };
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;
