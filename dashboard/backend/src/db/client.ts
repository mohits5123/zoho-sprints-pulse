import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client instance for database operations.
 * 
 * This module exports a globally accessible Prisma client singleton that is initialized
 * at module load time. It provides type-safe access to all PrismaClient methods for
 * interacting with the database through migrations defined in prisma/schema.prisma.
 * 
 * Usage:
 *   import prisma from './db/client';
 *   
 *   // Example queries:
 *   const user = await prisma.user.findFirst({ where: { email } });
 *   await prisma.issue.create({ data: { ... } });
 *   const stats = await prisma.$queryRawUnsafe('SELECT...', parameters);
 */

const prisma = new PrismaClient();

export default prisma;
