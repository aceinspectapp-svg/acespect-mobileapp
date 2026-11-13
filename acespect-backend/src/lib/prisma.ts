import { PrismaClient } from '@prisma/client';
import { isProd, prismaDatabaseUrl } from '../config/env';

/**
 * Single PrismaClient for the process. The globalThis cache prevents a new
 * client (and connection pool) being created on every hot-reload in dev.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
    // The pool size and wait from DATABASE_CONNECTION_LIMIT / DATABASE_POOL_TIMEOUT (config/env.ts), also set in process.env for Prisma's CLI.
    datasources: { db: { url: prismaDatabaseUrl } },
  });

if (!isProd) globalForPrisma.prisma = prisma;
