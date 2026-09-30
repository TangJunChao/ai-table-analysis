import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";
import { runQuery } from "@/lib/dbdriver";
import type { RowData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 对数据源执行只读 SQL（AI 问数结果的执行端） */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { sql?: string; limit?: number };
    if (!body.sql || typeof body.sql !== "string") {
      return Response.json({ error: "缺少 sql 参数" }, { status: 400 });
    }
    const limit = Math.min(Math.max(body.limit ?? 5000, 1), 20000);

    const user = await ensureDemoUser();
    const source = await prisma.dataSource.findFirst({
      where: { id, userId: user.id },
    });
    if (!source) {
      return Response.json({ error: "数据源不存在" }, { status: 404 });
    }

    const result = await runQuery(
      { type: source.type as "sqlite" | "postgres" | "mysql", url: source.url },
      body.sql,
      limit,
    );
    return Response.json({ ...result, rows: result.rows as RowData[] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
