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
  // Purpose gate — first screen after login. Chooses which flow to enter;
  // does not itself belong to either one.
  SelectPurpose: undefined;
  SelectInspectionType: undefined;
  // Sync/storage preferences — Wi-Fi-only upload toggle, local storage usage.
  Settings: undefined;
  // Admin-published template versions this inspector hasn't accepted yet —
  // accepting one only affects inspections started after that point.
  TemplateUpdates: undefined;
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

  // ─── QC flow — separate from the Houspect screens above, entered via
  // SelectPurpose. See src/screens/qc/*. Client/project/property config and
  // defect creation/assignment are admin-only now (acespect-web's QC
  // section) — mobile is "my assigned defects/tasks": QcHome branches into
  // the Defects list (view/edit a defect's own details) and the Tasks list
  // (site-visit activity log, comments + photos).
  QcHome: undefined;
  QcDefectsList: undefined;
  QcTasksList: undefined;
  QcTaskDetail: { taskId: string };
  QcDefectDetail: { defectId: string };
};

export type AuthScreenProps<T extends keyof AuthStackParamList> =
  NativeStackScreenProps<AuthStackParamList, T>;

export type AppScreenProps<T extends keyof AppStackParamList> =
  NativeStackScreenProps<AppStackParamList, T>;
