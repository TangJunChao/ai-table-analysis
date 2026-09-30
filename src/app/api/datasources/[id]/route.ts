import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 删除数据源连接 */
export async function DELETE(
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
    await prisma.dataSource.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
