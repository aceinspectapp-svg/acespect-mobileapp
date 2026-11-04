import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { ApiError } from '../../utils/ApiError';
import { audit } from '../../lib/auditTrail';
import { hashPassword } from '../../utils/password';
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
export async function createUser(input: CreateUserInput) {
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
 * Permanently removes an inspector or reviewer account. An Admin account can never be deleted here. A person who already has inspections,
 * reviews or QC records is kept (those records belong to the business): the database refuses and the Admin is told to deactivate instead.
 */
export async function deleteUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, name: true, role: true } });
  if (!user) throw ApiError.notFound('User not found');
  if (user.role !== 'INSPECTOR' && user.role !== 'REVIEWER') throw ApiError.forbidden('Only inspector and reviewer accounts can be deleted');
  try {
    await prisma.user.delete({ where: { id } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      throw ApiError.conflict('This person already has inspections or other records, so the account cannot be deleted.', 'USER_HAS_RECORDS');
    }
    throw err;
  }
  await audit({
    category: 'admin', action: 'user.delete', target: { type: 'User', id, label: user.email },
    before: { email: user.email, name: user.name, role: user.role },
    message: `Account ${user.email} deleted`,
  });
}
