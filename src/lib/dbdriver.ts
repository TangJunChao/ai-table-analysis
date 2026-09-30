import { DatabaseSync } from "node:sqlite";
import type { RowData } from "./types";

/**
 * 数据库直连驱动（统一接口）：SQLite / PostgreSQL / MySQL
 * - SQLite：Node 22 内置 node:sqlite（零依赖）
 * - PostgreSQL：pg
 * - MySQL：mysql2
 */

export type DbType = "sqlite" | "postgres" | "mysql";

export interface DbConfig {
  type: DbType;
  url: string;
}

export interface DbColumn {
  name: string;
  type: string;
}

export interface QueryResult {
  columns: string[];
  rows: RowData[];
}

/** 从连接串解析 SQLite 文件路径（支持 sqlite:./a.db / sqlite:/abs / sqlite:///abs） */
function sqlitePath(url: string): string {
  let p = url.slice(url.indexOf(":") + 1);
  if (p.startsWith("///")) p = p.slice(2);
  else if (p.startsWith("//")) p = p.slice(1);
  return p;
}

/** 按方言包标识符 */
export function quoteIdent(type: DbType, name: string): string {
  if (type === "mysql") return "`" + name.replace(/`/g, "``") + "`";
  return '"' + name.replace(/"/g, '""') + '"';
}

/** 数据库列类型 → 领域类型（string / number / date / boolean） */
export function mapDbType(type: string): "string" | "number" | "date" | "boolean" {
  const t = (type || "").toUpperCase();
  if (/BOOL/.test(t)) return "boolean";
  if (/DATE|TIME|TIMESTAMP/.test(t)) return "date";
  if (/INT|DECIMAL|NUMERIC|REAL|DOUBLE|FLOAT|MONEY/.test(t)) return "number";
  return "string";
}

/** 把驱动返回的任意值转成可安全 JSON 序列化的类型 */
function toPlain(v: unknown): unknown {
  if (v == null) return v;
  if (typeof v === "bigint") return Number(v);
  if (Buffer.isBuffer(v)) return v.toString();
  if (v instanceof Date) return v.toISOString().slice(0, 19).replace("T", " ");
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = toPlain(val);
    }
    return out;
  }
  return v;
}

/** 列出库中所有表名 */
export async function listTables(cfg: DbConfig): Promise<string[]> {
  if (cfg.type === "sqlite") {
    const db = new DatabaseSync(sqlitePath(cfg.url));
    try {
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all();
      return rows.map((r) => String(r.name));
    } finally {
      db.close();
    }
  }

  if (cfg.type === "postgres") {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: cfg.url });
    try {
      await client.connect();
      const res = await client.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name",
      );
      return res.rows.map((r) => String(r.table_name));
    } finally {
      await client.end();
    }
  }

  // mysql
  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(cfg.url);
  try {
    const [rows] = await conn.query(
      "SELECT TABLE_NAME AS table_name FROM information_schema.tables WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME",
    );
    return (rows as { table_name: string }[]).map((r) => r.table_name);
  } finally {
    await conn.end();
  }
}

/** 获取某表的列（名称 + 类型） */
export async function getColumns(
  cfg: DbConfig,
  table: string,
): Promise<DbColumn[]> {
  if (cfg.type === "sqlite") {
    const db = new DatabaseSync(sqlitePath(cfg.url));
    try {
      const rows = db.prepare(`PRAGMA table_info(${quoteIdent("sqlite", table)})`).all();
      return rows.map((r) => ({ name: String(r.name), type: String(r.type ?? "") }));
    } finally {
      db.close();
    }
  }

  if (cfg.type === "postgres") {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: cfg.url });
    try {
      await client.connect();
      const res = await client.query(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
        [table],
      );
      return res.rows.map((r) => ({ name: String(r.column_name), type: String(r.data_type) }));
    } finally {
      await client.end();
    }
  }

  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(cfg.url);
  try {
    const [rows] = await conn.query(
      "SELECT COLUMN_NAME AS column_name, DATA_TYPE AS data_type FROM information_schema.columns WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
      [table],
    );
    return (rows as { column_name: string; data_type: string }[]).map((r) => ({
      name: r.column_name,
      type: r.data_type,
    }));
  } finally {
    await conn.end();
  }
}

/** 执行只读查询（强制包裹 LIMIT，防止误执行写操作） */
export async function runQuery(
  cfg: DbConfig,
  sql: string,
  limit = 5000,
): Promise<QueryResult> {
  if (!/^\s*(select|with)\b/i.test(sql)) {
    throw new Error("仅允许执行 SELECT / WITH 只读查询");
  }
  const wrapped = `SELECT * FROM (${sql.replace(/;\s*$/, "")}) AS __q LIMIT ${Math.floor(limit)}`;

  if (cfg.type === "sqlite") {
    const db = new DatabaseSync(sqlitePath(cfg.url), { readOnly: true });
    try {
      const stmt = db.prepare(wrapped);
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = stmt.columns().map((c) => c.name);
      return { columns, rows: rows.map((r) => toPlain(r) as RowData) };
    } finally {
      db.close();
    }
  }

  if (cfg.type === "postgres") {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: cfg.url });
    try {
      await client.connect();
      const res = await client.query(wrapped);
      return {
        columns: (res.fields ?? []).map((f) => f.name),
        rows: res.rows.map((r) => toPlain(r) as RowData),
      };
    } finally {
      await client.end();
    }
  }

  const mysql = await import("mysql2/promise");
  const conn = await mysql.createConnection(cfg.url);
  try {
    const [rows, fields] = await conn.query(wrapped);
    return {
      columns: (fields ?? []).map((f) => f.name),
      rows: (rows as Record<string, unknown>[]).map((r) => toPlain(r) as RowData),
    };
  } finally {
    await conn.end();
  }
}

/** 测试连接是否可用 */
export async function testConnection(cfg: DbConfig): Promise<void> {
  await listTables(cfg);
}
