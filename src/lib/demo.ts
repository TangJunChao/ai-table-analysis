import { prisma } from "./db";

/**
 * 演示数据引导（无登录系统前的临时方案）
 * 首次调用自动创建 demo 用户与默认项目，供数据持久化与问数记录使用。
 * 接入认证后替换为真实 session 用户。
 */
const DEMO_EMAIL = "demo@example.com";

export async function ensureDemoUser() {
  let user = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: { email: DEMO_EMAIL, passwordHash: "dev-only" },
    });
  }
  return user;
}

export async function ensureDemoProject() {
  const user = await ensureDemoUser();
  let project = await prisma.project.findFirst({
    where: { userId: user.id, name: "默认项目" },
  });
  if (!project) {
    project = await prisma.project.create({
      data: { userId: user.id, name: "默认项目" },
    });
  }
  return project;
}
