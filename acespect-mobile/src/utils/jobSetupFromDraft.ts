import type { AnswerTree } from '../components/inspection/fieldRenderers/types';
import { JobSetupData } from '../types/jobSetup';
import { InspectionTypeId, PropertyTypeId } from '../types/inspection';

/**
 * Reconstructs the Job Setup shape from the draft's own state (propertyTypeId
 * /inspectionTypeId + the Job Information section's answers) rather than a
 * navigation param. Used wherever a screen needs `JobSetupData` but can't
 * rely on `route.params.data` having been passed in -- e.g. resuming a
 * persisted draft, where there's no navigation history to carry it.
 */
export function buildJobSetupDataFromDraft(
  top: { propertyTypeId?: string; inspectionTypeId?: string },
  jobAnswers: AnswerTree | undefined,
): JobSetupData {
  const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
  return {
    selection: {
      propertyTypeId: (top.propertyTypeId ?? '') as PropertyTypeId,
      inspectionTypeId: (top.inspectionTypeId ?? '') as InspectionTypeId,
    },
    details: {
      jobNumber: asStr(jobAnswers?.jobNumber),
      inspectionDate: asStr(jobAnswers?.inspectionDate),
      clientName: asStr(jobAnswers?.clientName),
      inspectionAddress: asStr(jobAnswers?.inspectionAddress),
      assignedInspector: asStr(jobAnswers?.assignedInspector),
      gpsConfirmed: !!asStr(jobAnswers?.inspectionAddress).trim(),
    },
    weather: Array.isArray(jobAnswers?.weather)
      ? (jobAnswers!.weather as unknown as string[]).join(', ')
      : asStr(jobAnswers?.weather),
    usedAsBusiness: (asStr(jobAnswers?.usedAsBusiness) || 'no') as JobSetupData['usedAsBusiness'],
    systemStatus: { startedAt: '', gpsLocation: '', photoSequence: '', cloudSync: 'Offline', offlineSave: 'Inactive' },
  };
}
