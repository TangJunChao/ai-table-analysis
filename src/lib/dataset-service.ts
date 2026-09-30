import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ensureDemoProject } from "@/lib/demo";
import { saveRows } from "@/lib/storage";
import type { DatasetColumn, RowData, SourceType } from "./types";

export interface CreateDatasetInput {
  name: string;
  sourceType: SourceType;
  rows: RowData[];
  columns: DatasetColumn[];
}

/** 行数据 + 列结构 → 数据集（写文件 + 元信息/列落库）。上传与数据库导入共用。 */
export async function createDatasetFromRows(input: CreateDatasetInput) {
  const { name, sourceType, rows, columns } = input;

  if (rows.length > 200_000) {
    throw new Error("单次最多保存 20 万行");
  }
  if (!rows.length) {
    throw new Error("没有可保存的数据");
  }

  const project = await ensureDemoProject();
  const fileName = await saveRows(rows);

  const dataset = await prisma.dataset.create({
    data: {
      projectId: project.id,
      name,
      sourceType,
      filePath: fileName,
      status: "ready",
      rowCount: rows.length,
      schema: columns.length
        ? (columns as unknown as Prisma.InputJsonValue)
        : undefined,
      columns: {
        create: columns.map((c, i) => ({
          name: c.name,
          dataType: c.data_type,
          nullable: c.nullable,
          position: c.position ?? i,
          stats: c.stats
            ? (c.stats as unknown as Prisma.InputJsonValue)
            : undefined,
        })),
      },
    },
    select: {
      id: true,
      name: true,
      sourceType: true,
      status: true,
      rowCount: true,
      createdAt: true,
    },
  });

  return dataset;
}
