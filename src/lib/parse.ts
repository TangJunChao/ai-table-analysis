import * as XLSX from "xlsx";
import type {
  ColumnDataType,
  ColumnStats,
  DatasetColumn,
  ParsedTable,
  RowData,
} from "./types";

/**
 * 文件解析：基于 SheetJS 读取 CSV / Excel / JSON
 * 返回扁平行数据 + 推断出的列元信息（供 AG Grid 渲染和 LLM 生成 SQL）
 */

/** 根据取值推断列类型 */
export function inferType(values: unknown[]): ColumnDataType {
  let hasNum = false;
  let hasBool = false;
  let hasDate = false;

  for (const v of values) {
    if (v == null || v === "") continue;
    if (typeof v === "number") {
      hasNum = true;
      continue;
    }
    if (typeof v === "boolean") {
      hasBool = true;
      continue;
    }
    const s = String(v).trim();
    if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(s)) {
      hasNum = true;
    } else if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) {
      hasDate = true;
    }
  }

  if (hasDate) return "date";
  if (hasBool) return "boolean";
  if (hasNum) return "number";
  return "string";
}

/** 统计单列信息（min/max/唯一值数/空值率），用于构造 LLM 提示词上下文 */
function buildColumnStats(values: unknown[]): ColumnStats {
  const nonNull = values.filter((v) => v != null && v !== "");
  const nums = nonNull
    .map(Number)
    .filter((n) => Number.isFinite(n));

  const stats: ColumnStats = {
    unique: new Set(nonNull.map(String)).size,
    null_ratio: values.length
      ? (values.length - nonNull.length) / values.length
      : 0,
  };
  if (nums.length) {
    stats.min = Math.min(...nums);
    stats.max = Math.max(...nums);
  }
  return stats;
}

/** 根据行数据重建列元信息（用于问数结果回填后更新 schema） */
export function buildColumnsFromRows(rows: RowData[]): DatasetColumn[] {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  return keys.map((name, position) => {
    const values = rows.map((r) => r[name]);
    return {
      name,
      data_type: inferType(values),
      nullable: values.some((v) => v == null || v === ""),
      position,
      stats: buildColumnStats(values),
    };
  });
}

/** Date → YYYY-MM-DD 字符串（避免浏览器时区影响，用 UTC ISO 截取） */
function toDateString(v: Date): string {
  return v.toISOString().slice(0, 10);
}

/** 归一化单元格：Date 转字符串 */
function normalizeCell(v: unknown): unknown {
  return v instanceof Date ? toDateString(v) : v;
}

/** 统计一行/列中非空单元格数量 */
function countNonEmpty(cells: unknown[]): number {
  return cells.filter((v) => v != null && v !== "").length;
}

/**
 * 自动探测表头行：扫描前 N 行，取"非空单元格最多"的行作为表头。
 * 兼容：顶部有标题行/日期行/空行的表格。
 */
function detectHeaderRow(matrix: unknown[][]): number {
  const scan = Math.min(10, matrix.length);
  let best = 0;
  let bestCount = -1;
  for (let i = 0; i < scan; i++) {
    const count = countNonEmpty(matrix[i] ?? []);
    if (count > bestCount) {
      bestCount = count;
      best = i;
    }
  }
  return best;
}

/** 生成列名：空表头补 __EMPTY，重复列名追加 _1/_2 */
function buildHeader(cells: unknown[]): string[] {
  const names: string[] = [];
  const seen = new Map<string, number>();
  for (const v of cells) {
    const base =
      v == null || String(v).trim() === "" ? "__EMPTY" : String(v).trim();
    const n = seen.get(base) ?? 0;
    const name = n === 0 ? base : `${base}_${n}`;
    seen.set(base, n + 1);
    names.push(name);
  }
  return names;
}

/** 过滤全空列（所有行该列都为空） */
function dropEmptyColumns(rows: RowData[]): RowData[] {
  if (!rows.length) return rows;
  const keys = Object.keys(rows[0]);
  const keep = keys.filter((k) =>
    rows.some((r) => r[k] != null && r[k] !== ""),
  );
  return rows.map((r) =>
    Object.fromEntries(keep.map((k) => [k, r[k]])),
  );
}

/** 清洗数值列：类型推断为 number 的列中，混入的非数值文本置为 null（如月份标签"租金（2月）"） */
function cleanNumericColumns(rows: RowData[]): RowData[] {
  if (!rows.length) return rows;
  for (const key of Object.keys(rows[0])) {
    if (inferType(rows.map((r) => r[key])) !== "number") continue;
    for (const r of rows) {
      const v = r[key];
      if (v == null || v === "") continue;
      if (typeof v !== "number" && !/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(String(v).trim())) {
        r[key] = null;
      }
    }
  }
  return rows;
}

/** 解析单个文件为表格（自适应：自动探测表头、过滤空行/空列、列名去重） */
export async function parseFile(file: File): Promise<ParsedTable> {
  const lower = file.name.toLowerCase();
  const isText = lower.endsWith(".csv") || lower.endsWith(".json");

  let workbook: XLSX.WorkBook;
  if (isText) {
    // CSV/JSON 按 UTF-8 文本读取：避免 type:"array" 对无 BOM 中文 CSV 的乱码
    const text = await file.text();
    workbook = XLSX.read(text, { type: "string", cellDates: true });
  } else {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  }

  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // 以二维矩阵读取，便于探测表头与过滤
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];

  const headerIdx = detectHeaderRow(matrix);
  const headers = buildHeader(matrix[headerIdx] ?? []);

  const rawRows: RowData[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    // 跳过全空行与合并的"标题/分隔行"（非空单元格 <= 1）
    if (countNonEmpty(cells) <= 1) continue;
    const row: RowData = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]] = normalizeCell(cells[c] ?? null);
    }
    rawRows.push(row);
  }

  const rows = cleanNumericColumns(dropEmptyColumns(rawRows));
  return { name: file.name, rows, columns: buildColumnsFromRows(rows) };
}
