import { prisma } from "@/lib/db";
import { createDatasetFromRows } from "@/lib/dataset-service";
import type { DatasetColumn, RowData, SourceType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 列出已保存的数据集（仅元信息） */
export async function GET() {
  const datasets = await prisma.dataset.findMany({
    select: {
      id: true,
      name: true,
      sourceType: true,
      status: true,
      rowCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  return Response.json({ datasets });
}

/** 保存数据集：行数据写入文件，元信息 + 列结构落库 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      name?: string;
      sourceType?: SourceType;
      rows?: RowData[];
      columns?: DatasetColumn[];
    };

    if (!body.name || !Array.isArray(body.rows)) {
      return Response.json({ error: "参数不完整：需要 name 和 rows" }, { status: 400 });
    }

    const dataset = await createDatasetFromRows({
      name: body.name,
      sourceType: body.sourceType ?? "csv",
      rows: body.rows,
      columns: Array.isArray(body.columns) ? body.columns : [],
    });

    return Response.json({ dataset }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
