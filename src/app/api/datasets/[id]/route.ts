import { prisma } from "@/lib/db";
import { readRows, deleteRows } from "@/lib/storage";
import type { DatasetColumn, RowData } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 加载数据集：元信息 + 列结构 + 行数据 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const dataset = await prisma.dataset.findUnique({
      where: { id },
      include: { columns: { orderBy: { position: "asc" } } },
    });

    if (!dataset) {
      return Response.json({ error: "数据集不存在" }, { status: 404 });
    }

    const rows = await readRows(dataset.filePath);
    const columns: DatasetColumn[] = dataset.columns.map((c) => ({
      name: c.name,
      data_type: c.dataType as DatasetColumn["data_type"],
      nullable: c.nullable,
      position: c.position,
      stats: (c.stats as DatasetColumn["stats"]) ?? undefined,
    }));

    const result: { dataset: unknown; columns: DatasetColumn[]; rows: RowData[] } =
      {
        dataset: {
          id: dataset.id,
          name: dataset.name,
          sourceType: dataset.sourceType,
          status: dataset.status,
          rowCount: dataset.rowCount,
          createdAt: dataset.createdAt,
        },
        columns,
        rows,
      };
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** 删除数据集（级联删除列，并清理行数据文件） */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const dataset = await prisma.dataset.findUnique({ where: { id } });
    if (!dataset) {
      return Response.json({ error: "数据集不存在" }, { status: 404 });
    }
    await prisma.dataset.delete({ where: { id } });
    await deleteRows(dataset.filePath);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
