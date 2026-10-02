import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';

export const userSelect = { id: true, name: true, email: true } as const;

export const defectInclude = {
  property: {
    include: {
      project: { include: { client: true, builder: { select: { id: true, name: true } } } },
      site: { select: { id: true, name: true } },
      propertyType: true,
    },
  },
  severity: true,
  status: true,
  tradeCategory: { select: { id: true, name: true, code: true } },
  assignedTo: { select: userSelect },
  createdBy: { select: userSelect },
  builderContact: { select: userSelect },
  allocatedTradeCompany: { select: { id: true, name: true } },
  allocatedTradeUser: { select: userSelect },
  closedBy: { select: userSelect },
} as const;

export const taskInclude = {
  defect: { include: defectInclude },
  assignedTo: { select: userSelect },
} as const;

type ModelName =
  | 'qcClient' | 'qcProject' | 'qcProperty' | 'qcPropertyType' | 'qcSeverity' | 'qcStatus' | 'qcDefect' | 'user'
  | 'qcMasterContractor' | 'qcTradeCompany' | 'qcTradeCategory' | 'qcSite' | 'qcMembership';

export async function requireExists(model: ModelName, id: string, label: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await (prisma[model] as any).findUnique({ where: { id } });
  if (!row) throw ApiError.notFound(`${label} not found`);
  return row;
}
