import * as XLSX from "xlsx";
import type { RowData } from "./types";

/** 估算字符串显示宽度（中文按 2 个字符宽计） */
function textWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += ch.charCodeAt(0) > 255 ? 2 : 1;
  }
  return w;
}

/**
 * 将行数据导出为 Excel（.xlsx）并触发浏览器下载。
 * baseName：导出文件名的基础名（如原文件名），会自动去掉扩展名并追加"导出"后缀。
 */
export function exportRowsToExcel(rows: RowData[], baseName: string): void {
  if (!rows.length) return;

  const sheet = XLSX.utils.json_to_sheet(rows);

  // 自动列宽：基于内容长度估算（采样前 500 行，避免大数据量卡顿）
  const keys = Object.keys(rows[0]);
  const sample = rows.slice(0, 500);
  const widths = keys.map((k) => {
    let max = textWidth(k);
    for (const r of sample) {
      const v = r[k];
      if (v == null) continue;
      const w = textWidth(String(v));
      if (w > max) max = w;
    }
    return Math.min(max + 2, 40);
  });
  sheet["!cols"] = keys.map((_, i) => ({ wch: widths[i] }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "数据");

  const base = (baseName || "表格").replace(/\.[^.]+$/, "") || "表格";
  XLSX.writeFile(wb, `${base}_导出.xlsx`);
}
