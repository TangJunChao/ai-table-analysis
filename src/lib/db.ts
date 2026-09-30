import { PrismaClient } from "@prisma/client";

/**
 * Prisma Client 单例（开发环境热重载时避免连接泄漏）
 */
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
