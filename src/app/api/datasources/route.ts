import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";
import { testConnection, type DbType } from "@/lib/dbdriver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出已保存的数据源（不返回连接串等敏感信息） */
export async function GET() {
  try {
    const user = await ensureDemoUser();
    const sources = await prisma.dataSource.findMany({
      where: { userId: user.id },
      select: { id: true, name: true, type: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    return Response.json({ sources });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** 新增数据源：先测试连接，成功后再保存 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      type?: string;
      url?: string;
    };
    const type = body.type as DbType;
    if (!type || !["sqlite", "postgres", "mysql"].includes(type)) {
      return Response.json({ error: "type 必须是 sqlite / postgres / mysql" }, { status: 400 });
    }
    if (!body.url || typeof body.url !== "string") {
      return Response.json({ error: "缺少连接串 url" }, { status: 400 });
    }
    const name = body.name?.trim() || "未命名数据源";

    // 先验证连接可用
    await testConnection({ type, url: body.url });

    const user = await ensureDemoUser();
    const source = await prisma.dataSource.create({
      data: { name, type, url: body.url, userId: user.id },
      select: { id: true, name: true, type: true, createdAt: true },
    });
    return Response.json({ source }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json(
      { error: `连接失败：${message}` },
      { status: 400 },
    );
  }
}
