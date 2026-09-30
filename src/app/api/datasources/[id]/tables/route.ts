import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";
import { listTables } from "@/lib/dbdriver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出数据源中的所有表 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const user = await ensureDemoUser();
    const source = await prisma.dataSource.findFirst({
      where: { id, userId: user.id },
    });
    if (!source) {
      return Response.json({ error: "数据源不存在" }, { status: 404 });
    }

    const tables = await listTables({
      type: source.type as "sqlite" | "postgres" | "mysql",
      url: source.url,
    });
    return Response.json({ tables });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
