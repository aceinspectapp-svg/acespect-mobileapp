import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { audit } from '../../lib/auditTrail';
import { hashPassword } from '../../utils/password';
import { clearAuthCache } from '../../middleware/auth';
import { serializeUser } from '../web/web.serializers';

/** What an Admin enters to create an inspector or reviewer who can sign in straight away. */
export const createUserSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  email: z.string().trim().toLowerCase().email('A valid email is required'),
  password: z.string().min(12, 'Password must be at least 12 characters').max(128, 'Password is too long'),
  role: z.enum(['INSPECTOR', 'REVIEWER']),
  phone: z.string().trim().max(50).optional(),
  region: z.string().trim().max(200).optional(),
  licenseNumber: z.string().trim().max(100).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

/** Creates the account with the password the Admin chose; the Admin gives it to the person. Never creates an Admin. */
export async function createUser(input: CreateUserInput, createdById?: string) {
  if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
    throw ApiError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }
  const row = await prisma.user.create({
    data: {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      passwordChangedAt: new Date(),
      name: input.name,
      phone: input.phone || null,
      region: input.region || null,
      licenseNumber: input.licenseNumber || null,
      role: input.role,
      createdById,
    },
  });
  await audit({
    category: 'admin', action: 'user.create', target: { type: 'User', id: row.id, label: row.email },
    after: { email: row.email, name: row.name, role: input.role },
    message: `Account created for ${row.email} as ${input.role.toLowerCase()}`,
  });
  return serializeUser(row);
}

/**
 * Permanently removes an inspector or reviewer account that has no history. An Admin account can never be deleted here. Anyone with inspections,
 * reviews or a QC role is kept and is switched off instead (Admin -> Users): deleting a reviewer would otherwise blank the reviewer on every
 * inspection they handled, and deleting a QC private inspector would quietly remove them from their client.
 */
export async function deleteUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true } });
  if (!user) throw ApiError.notFound('User not found');
  if (user.role !== 'INSPECTOR' && user.role !== 'REVIEWER') throw ApiError.forbidden('Only inspector and reviewer accounts can be deleted');
  const who = user.name ?? user.email;
  if ((await prisma.qcMembership.count({ where: { userId: id } })) > 0) {
    throw new ApiError(409, `${who} also holds a role in a QC client, so they are managed on the QC People page.`, 'QC_MANAGED');
  }
  const history = (await prisma.inspection.count({ where: { OR: [{ inspectorId: id }, { reviewerId: id }] } })) + (await prisma.reviewDecision.count({ where: { reviewerId: id } }));
  const hasRecords = () => ApiError.conflict(`${who} has inspections or other records, so the account cannot be deleted. Switch it off instead: they lose access and their history stays.`, 'USER_HAS_RECORDS');
  if (history > 0) throw hasRecords();
  try {
    await prisma.user.delete({ where: { id } });
  } catch (err) {
    // Any other record that still points at the person: the database refuses, which is the right answer.
    if (err instanceof Prisma.PrismaClientKnownRequestError || err instanceof Prisma.PrismaClientUnknownRequestError) throw hasRecords();
    throw err;
  }
  clearAuthCache(id);
  await audit({
    category: 'admin', action: 'user.delete', target: { type: 'User', id, label: user.email },
    before: { email: user.email, name: user.name, role: user.role },
    message: `Account ${user.email} deleted`,
  });
}
