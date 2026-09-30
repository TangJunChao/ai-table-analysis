import { promises as fs } from "fs";
import path from "path";
import type { RowData } from "./types";

/**
 * 行数据文件存储（开发期替代对象存储）
 *
 * 设计：原始表格数据不落数据库，只存元信息；
 * 行数据以 JSON 文件存到本地 data/datasets/ 目录，datasets.file_path 记录文件名。
 * 后续接入 S3/R2 时替换本模块即可。
 */
const DATA_DIR = path.join(process.cwd(), "data", "datasets");

/** 保存行数据，返回文件名（如 abc123.json） */
export async function saveRows(rows: RowData[]): Promise<string> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}.json`;
  await fs.writeFile(
    path.join(DATA_DIR, fileName),
    JSON.stringify(rows),
    "utf-8",
  );
  return fileName;
}

/** 读取行数据（filePath 为 saveRows 返回的文件名） */
export async function readRows(filePath: string): Promise<RowData[]> {
  const raw = await fs.readFile(path.join(DATA_DIR, filePath), "utf-8");
  return JSON.parse(raw) as RowData[];
}

/** 删除行数据文件 */
export async function deleteRows(filePath: string): Promise<void> {
  await fs.unlink(path.join(DATA_DIR, filePath)).catch(() => {});
}
