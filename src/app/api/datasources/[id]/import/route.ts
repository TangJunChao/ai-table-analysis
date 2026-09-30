import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";
import { createDatasetFromRows } from "@/lib/dataset-service";
import {
  getColumns,
  mapDbType,
  quoteIdent,
  runQuery,
} from "@/lib/dbdriver";
import type { DatasetColumn, RowData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IMPORT_LIMIT = 200_000;

/** 把数据源中的一张表导入为持久化数据集（复用上传数据集的落库流程） */
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

    const user = await ensureDemoUser();
    const source = await prisma.dataSource.findFirst({
      where: { id, userId: user.id },
    });
    if (!source) {
      return Response.json({ error: "数据源不存在" }, { status: 404 });
    }
    const type = source.type as "sqlite" | "postgres" | "mysql";

    // 读取整表数据（上限 20 万行）
    const limit = Math.min(Math.max(body.limit ?? IMPORT_LIMIT, 1), IMPORT_LIMIT);
    const sql = `SELECT * FROM ${quoteIdent(type, body.table)}`;
    const result = await runQuery({ type, url: source.url }, sql, limit);
    if (!result.rows.length) {
      return Response.json({ error: "该表没有数据" }, { status: 400 });
    }

    // 由列类型 + 数据推断 schema
    const columns = await getColumns({ type, url: source.url }, body.table);
    const schema: DatasetColumn[] = columns.map((c, position) => ({
      name: c.name,
      data_type: mapDbType(c.type),
      nullable: result.rows.some(
        (r) => r[c.name] == null || r[c.name] === "",
      ),
      position,
    }));

    const dataset = await createDatasetFromRows({
      name: `${source.name} · ${body.table}`,
      sourceType: "csv",
      rows: result.rows as RowData[],
      columns: schema,
    });

    return Response.json({ dataset }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
