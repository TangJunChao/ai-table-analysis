/**
 * 领域类型定义（与数据库表结构一一对应，见 DDL）
 */

// ---------- 数据源 ----------
export type SourceType = "csv" | "xlsx" | "json";
export type DatasetStatus = "processing" | "ready" | "failed";
export type ColumnDataType = "string" | "number" | "date" | "boolean";

// ---------- 表结构实体 ----------
export interface User {
  id: string;
  email: string;
  name?: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description?: string;
}

export interface DatasetColumn {
  name: string;
  data_type: ColumnDataType;
  nullable: boolean;
  position: number;
  stats?: ColumnStats;
}

export interface ColumnStats {
  min?: number;
  max?: number;
  unique?: number;
  null_ratio?: number;
}

export interface Dataset {
  id: string;
  project_id: string;
  name: string;
  source_type: SourceType;
  status: DatasetStatus;
  row_count: number;
  /** 列元信息快照（喂给 LLM 生成 SQL 的上下文） */
  schema: DatasetColumn[];
}

export interface Conversation {
  id: string;
  dataset_id: string;
  user_id: string;
  title?: string;
}

export type QueryStatus = "pending" | "running" | "success" | "failed";

export interface AnalysisQuery {
  id: string;
  conversation_id?: string;
  dataset_id: string;
  user_id: string;
  question: string;
  sql?: string;
  result_preview?: RowData[];
  status: QueryStatus;
  error_message?: string;
}

// ---------- UI 层 ----------
/** 表格行：扁平对象 */
export type RowData = Record<string, unknown>;

/** 文件解析结果 */
export interface ParsedTable {
  name: string;
  rows: RowData[];
  columns: DatasetColumn[];
}

// ---------- API 交互 ----------
/** 问数执行的 SQL 方言 */
export type Dialect = "duckdb" | "sqlite" | "postgres" | "mysql";

/** AI 意图识别：table=出表、chart=出图、chat=闲聊（不执行 SQL） */
export type Intent = "table" | "chart" | "chat";

/** 支持的图表类型 */
export type ChartType = "bar" | "line" | "pie";

export interface AnalyzeRequest {
  question: string;
  /** 当前数据集的表结构（列名 + 类型 + 统计） */
  schema: DatasetColumn[];
  /** 关联的已保存数据集（用于持久化问数记录） */
  datasetId?: string;
  /** 多轮会话 id（服务端创建后回传） */
  conversationId?: string;
  /** 上次生成的 SQL 执行失败，用于让 LLM 修正 */
  retryInfo?: { sql: string; error: string };
  /** SQL 方言（默认 duckdb，直连数据源时传目标方言） */
  dialect?: Dialect;
  /** 查询的表名（直连数据源时为源表名，默认 data） */
  tableName?: string;
}

export interface AnalyzeResponse {
  /** LLM 生成的 SQL（intent 为 chat 时为空字符串） */
  sql: string;
  /** 给用户的自然语言结论 */
  summary: string;
  /** AI 意图识别结果 */
  intent?: Intent;
  /** 用户明确要出图时，LLM 给出的图表类型 */
  chartType?: ChartType;
  /** 持久化后的问数记录 id */
  queryId?: string;
  /** 持久化后的会话 id */
  conversationId?: string;
}

/** DuckDB 查询结果 */
export interface QueryResult {
  columns: string[];
  rows: RowData[];
}

/** 问数结果附带的元信息（意图 + 图表类型），用于页面按意图渲染 */
export interface QueryResultMeta {
  intent?: Intent;
  chartType?: ChartType;
}

// ---------- 历史回放 ----------
export interface HistoryQueryItem {
  id: string;
  question: string;
  sql?: string;
  status: string;
  createdAt: string;
}

export interface HistoryConversation {
  id: string;
  title?: string;
  createdAt: string;
  queries: HistoryQueryItem[];
}

// ---------- 智能洞察 ----------
/** 单列画像（客户端从行数据聚合，发给 LLM 生成洞察） */
export interface DataProfileColumn {
  name: string;
  data_type: ColumnDataType;
  nulls: number;
  unique: number;
  min?: number;
  max?: number;
  avg?: number;
  sum?: number;
  /** 日期列的范围（可读字符串） */
  minDate?: string;
  maxDate?: string;
  /** 字符串列 Top 5 取值与频次 */
  top?: { value: string; count: number }[];
}

export interface DataProfile {
  rowCount: number;
  columns: DataProfileColumn[];
}

export interface InsightCard {
  type: "trend" | "anomaly" | "distribution" | "quality" | "highlight";
  title: string;
  content: string;
}
