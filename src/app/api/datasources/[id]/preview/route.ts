import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";
import {
  getColumns,
  mapDbType,
  quoteIdent,
  runQuery,
} from "@/lib/dbdriver";
import type { DatasetColumn, RowData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 预览某表：返回列结构 + 前 N 行数据（供前端展示并作为问数基准） */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as { table?: string; limit?: number };
    if (!body.table) {
      return Response.json({ error: "缺少 table 参数" }, { status: 400 });
    }
    const limit = Math.min(Math.max(body.limit ?? 500, 1), 5000);

    const user = await ensureDemoUser();
    const source = await prisma.dataSource.findFirst({
      where: { id, userId: user.id },
    });
    if (!source) {
      return Response.json({ error: "数据源不存在" }, { status: 404 });
    }
    const type = source.type as "sqlite" | "postgres" | "mysql";

    const columns = await getColumns({ type, url: source.url }, body.table);
    const sql = `SELECT * FROM ${quoteIdent(type, body.table)} LIMIT ${limit}`;
    const result = await runQuery({ type, url: source.url }, sql, limit);

    // 由列类型 + 预览数据推断领域 schema
    const schema: DatasetColumn[] = columns.map((c, position) => ({
      name: c.name,
      data_type: mapDbType(c.type),
      nullable: result.rows.some(
        (r) => r[c.name] == null || r[c.name] === "",
      ),
      position,
    }));

    return Response.json({
      source: { id: source.id, name: source.name, type, table: body.table },
      columns: schema,
      rows: result.rows as RowData[],
      total: result.rows.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
