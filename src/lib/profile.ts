import type { DataProfile, DatasetColumn, RowData } from "./types";

/**
 * 从行数据构建数据画像（单遍扫描，供 LLM 生成智能洞察）。
 * 只提取统计信息与 Top 值，不发送原始数据。
 */
export function buildProfile(
  rows: RowData[],
  columns: DatasetColumn[],
): DataProfile {
  const cols = columns.length
    ? columns
    : Object.keys(rows[0] ?? {}).map((name, position) => ({
        name,
        data_type: "string" as const,
        nullable: true,
        position,
      }));

  const profileCols = cols.map((col) => {
    const values = rows.map((r) => r[col.name]);
    const nonNull = values.filter((v) => v != null && v !== "");
    const entry: DataProfile["columns"][number] = {
      name: col.name,
      data_type: col.data_type,
      nulls: values.length - nonNull.length,
      unique: new Set(nonNull.map(String)).size,
    };

    if (col.data_type === "number") {
      const nums = nonNull.map(Number).filter((n) => Number.isFinite(n));
      if (nums.length) {
        entry.min = Math.min(...nums);
        entry.max = Math.max(...nums);
        entry.sum = Math.round(nums.reduce((a, b) => a + b, 0) * 100) / 100;
        entry.avg = Math.round((entry.sum / nums.length) * 100) / 100;
      }
    } else if (col.data_type === "string") {
      const freq = new Map<string, number>();
      for (const v of nonNull) {
        const s = String(v);
        freq.set(s, (freq.get(s) ?? 0) + 1);
      }
      entry.top = [...freq.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([value, count]) => ({ value, count }));
    } else if (col.data_type === "date") {
      const dates = nonNull.map(String).sort();
      if (dates.length) {
        entry.minDate = dates[0];
        entry.maxDate = dates[dates.length - 1];
      }
    }
    return entry;
  });

  return { rowCount: rows.length, columns: profileCols };
}
