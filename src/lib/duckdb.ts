import type { QueryResult, RowData } from "./types";

/**
 * DuckDB-WASM 封装（浏览器端运行 SQL）
 *
 * - 动态 import，避免进入服务端 bundle / SSR
 * - wasm 与 worker 已本地化到 public/duckdb/（不依赖 CDN）
 * - loadRows() 把当前表格数据注册为表 `data`（read_csv_auto 自动推断类型）
 * - query() 执行 SQL 并返回 { columns, rows }
 */
type AsyncDuckDB = Awaited<ReturnType<typeof createInstance>>;

/**
 * eh bundle（异常处理版，无需跨域隔离）
 * 注意：不用 mvp——该版本的 mvp worker glue 存在缺陷，
 * 会引用未定义的 _setThrew 导致 "ReferenceError: _setThrew is not defined"。
 * 资源位于 public/duckdb/
 */
const BUNDLE = {
  mainModule: "/duckdb/duckdb-eh.wasm",
  mainWorker: "/duckdb/duckdb-browser-eh.worker.js",
  pthreadWorker: null as string | null,
};

/** 转成浏览器端绝对 URL（importScripts 不接受相对路径） */
function bundleUrl(path: string): string {
  return new URL(path, window.location.origin).href;
}

let dbPromise: Promise<AsyncDuckDB> | null = null;

async function createInstance() {
  const duckdb = await import("@duckdb/duckdb-wasm");

  // 官方模式：用 importScripts 包一层 blob worker 加载 worker 脚本，
  // 直接 new Worker(file) 会导致 Emscripten 模块初始化异常（如 _setThrew 报错）
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${bundleUrl(BUNDLE.mainWorker)}");`], {
      type: "text/javascript",
    }),
  );
  const worker = new Worker(workerUrl);

  const instance = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), worker);
  await instance.instantiate(bundleUrl(BUNDLE.mainModule), BUNDLE.pthreadWorker);
  return instance;
}

/** 懒初始化 DuckDB 实例（浏览器内单例，失败可重试） */
function getDuckDB(): Promise<AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = createInstance().catch((err) => {
      dbPromise = null; // 初始化失败后允许下次重试
      throw err;
    });
  }
  return dbPromise;
}

/** 将扁平行数据注册为 DuckDB 表（表名固定为 data） */
export async function loadRows(rows: RowData[]): Promise<void> {
  const instance = await getDuckDB();
  const csv = rowsToCsv(rows);
  const fileName = "data.csv";
  await instance.registerFileBuffer(fileName, new TextEncoder().encode(csv));

  const conn = await instance.connect();
  try {
    await conn.query(
      `CREATE OR REPLACE TABLE data AS SELECT * FROM read_csv_auto('${fileName}')`,
    );
  } finally {
    await conn.close();
  }
}

/** 执行 SQL，返回列名 + 行数据 */
export async function query(sql: string): Promise<QueryResult> {
  const instance = await getDuckDB();
  const conn = await instance.connect();
  try {
    const arrow = await conn.query(sql);
    const columns = arrow.schema.fields.map((f) => f.name);
    const rows = arrow.toArray().map((r) => ({ ...(r as RowData) }));
    return { columns, rows };
  } finally {
    await conn.close();
  }
}

/** 简易 CSV 序列化（仅支持扁平行） */
function rowsToCsv(rows: RowData[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [keys.join(",")];
  for (const row of rows) {
    lines.push(keys.map((k) => escape(row[k])).join(","));
  }
  return lines.join("\n");
}
