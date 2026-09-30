"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DatasetColumn,
  Dialect,
  Intent,
  QueryResult,
  QueryResultMeta,
  RowData,
} from "@/lib/types";
import { loadRows, query } from "@/lib/duckdb";

interface ChatPanelProps {
  /** 分析基准表结构（数据集原始 schema，问数/多轮追问始终基于它，回填结果不覆盖） */
  schema: DatasetColumn[];
  /** 分析基准行数据（数据集原始数据，用于浏览器端 DuckDB 执行 SQL） */
  rows: RowData[];
  /** 关联的已保存数据集 id（持久化问数记录） */
  datasetId?: string | null;
  /** 直连数据源配置：设置后 SQL 走服务端执行，而不是浏览器 DuckDB */
  execution?: { connectionId: string; tableName: string; dialect: Dialect } | null;
  /** SQL 执行成功后的回调（用于回填表格/图表；meta 携带 AI 意图与图表类型） */
  onResult?: (result: QueryResult, meta?: QueryResultMeta) => void;
}

/** 暴露给父组件的方法（历史回放等） */
export interface ChatPanelHandle {
  /**
   * 直接执行一条历史 SQL 并回填结果。
   * rows：历史 SQL 生成时对应的数据（通常传数据集原始数据，避免对聚合结果重跑报错）
   */
  replay: (query: { question: string; sql: string; rows?: RowData[] }) => Promise<void>;
  /** 清空当前对话与多轮会话上下文（切换文档/数据源时由父组件调用） */
  clear: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  sql?: string;
  rowCount?: number;
}

type Stage = "idle" | "analyzing" | "executing";

/** AI 问数面板：问数 → 生成 SQL → DuckDB 执行 → 回填结果（执行失败自动重试一次） */
const ChatPanel = forwardRef<ChatPanelHandle, ChatPanelProps>(function ChatPanel(
  { schema, rows, datasetId, execution, onResult },
  ref,
) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const conversationIdRef = useRef<string | null>(null);
  // 消息滚动容器：新消息/状态变化时自动滚到底部
  const scrollRef = useRef<HTMLDivElement>(null);
  // rows 可能被父组件更新，用 ref 保持 replay 闭包内拿到的始终是最新数据
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, stage]);

  function pushMessage(msg: Message) {
    setMessages((prev) => [...prev, msg]);
  }

  /** 历史回放：直接执行历史 SQL（不经过 LLM） */
  const replay = useCallback(
    async (q: { question: string; sql: string; rows?: RowData[] }) => {
      if (!q.sql || stage !== "idle") return;
      pushMessage({ role: "user", content: q.question });
      setStage("executing");
      try {
        // 优先用调用方传入的数据（数据集原始数据），保证历史 SQL 的字段可用
        await loadRows(q.rows ?? rowsRef.current);
        const result = await query(q.sql);
        onResult?.(result);
        pushMessage({
          role: "assistant",
          content: "已根据历史记录重新执行该查询。",
          sql: q.sql,
          rowCount: result.rows.length,
        });
      } catch (err) {
        pushMessage({
          role: "assistant",
          content: `重跑失败：${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setStage("idle");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onResult],
  );

  /** 清空对话与多轮会话上下文（切换文档/数据源时调用） */
  const clear = useCallback(() => {
    setMessages([]);
    conversationIdRef.current = null;
    setStage("idle");
  }, []);

  useImperativeHandle(ref, () => ({ replay, clear }), [replay, clear]);

  async function handleSend() {
    const question = input.trim();
    if (!question || stage !== "idle") return;

    pushMessage({ role: "user", content: question });
    setInput("");
    setStage("analyzing");

    try {
      // 1. 服务端：LLM 生成 SQL + 结论 + 意图识别（直连数据源时指定方言与表名）
      const exec = execution;
      let resp = await callAnalyze(
        question,
        schema,
        datasetId ?? null,
        conversationIdRef.current,
        undefined,
        exec?.dialect,
        exec?.tableName,
      );
      if (resp.conversationId) conversationIdRef.current = resp.conversationId;

      // 闲聊意图：不执行 SQL，直接友好回复
      if (resp.intent === "chat") {
        pushMessage({ role: "assistant", content: resp.summary });
        return;
      }

      // 2. 执行：直连数据源走服务端，否则浏览器端 DuckDB-WASM（失败则携带错误重试一次）
      setStage("executing");
      let sql = resp.sql;
      let summary = resp.summary;
      // 显式标注，避免 TS 控制流收窄导致重试分支赋值报错
      let intent: Intent | undefined = resp.intent;
      let chartType = resp.chartType;
      let result: QueryResult;
      try {
        result = exec
          ? await runDbQuery(exec.connectionId, sql)
          : await runSql(rows, sql);
      } catch (execErr) {
        resp = await callAnalyze(
          question,
          schema,
          datasetId ?? null,
          conversationIdRef.current,
          {
            sql,
            error: execErr instanceof Error ? execErr.message : String(execErr),
          },
          exec?.dialect,
          exec?.tableName,
        );
        if (resp.conversationId) {
          conversationIdRef.current = resp.conversationId;
        }
        sql = resp.sql;
        summary = resp.summary;
        intent = resp.intent;
        chartType = resp.chartType;
        result = exec
          ? await runDbQuery(exec.connectionId, sql)
          : await runSql(rows, sql);
      }

      // 3. 回填表格/图表（带上意图与图表类型，页面据此渲染）
      onResult?.(result, { intent, chartType });
      pushMessage({
        role: "assistant",
        content: summary,
        sql,
        rowCount: result.rows.length,
      });
    } catch (err) {
      pushMessage({
        role: "assistant",
        content: `出错：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setStage("idle");
    }
  }

  return (
    <div className="flex h-[480px] shrink-0 flex-col gap-2">
      {messages.length > 0 && (
        <div className="flex justify-end">
          <button
            onClick={clear}
            disabled={stage !== "idle"}
            className="text-xs text-neutral-400 hover:text-red-500 disabled:opacity-40"
            title="清空当前对话"
          >
            清空对话
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto rounded-lg border border-neutral-200 p-3"
      >
        {messages.length === 0 && (
          <p className="text-sm text-neutral-500">
            试试输入自然语言问题，例如：「按区域统计销售额并排序」。
            {schema.length === 0 && "（当前使用示例数据）"}
          </p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "ml-auto bg-blue-600 text-white"
                : "bg-neutral-100 text-neutral-900"
            }`}
          >
            {m.content}
            {m.sql && (
              <div className="mt-2">
                <pre className="overflow-x-auto rounded bg-neutral-900 p-2 text-xs text-green-300">
                  {m.sql}
                </pre>
                {typeof m.rowCount === "number" && (
                  <p className="mt-1 text-xs text-neutral-500">
                    已执行，返回 {m.rowCount.toLocaleString()} 行，表格/图表已更新
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {stage === "analyzing" && (
          <p className="text-sm text-neutral-500">AI 生成 SQL 中…</p>
        )}
        {stage === "executing" && (
          <p className="text-sm text-neutral-500">DuckDB 执行查询中…</p>
        )}
      </div>

      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="输入问题，回车发送"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSend}
          disabled={stage !== "idle" || !input.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {stage === "idle" ? "发送" : "处理中"}
        </button>
      </div>
    </div>
  );
});
export default ChatPanel;

/** 将当前数据载入 DuckDB 并执行 SQL */
async function runSql(rows: RowData[], sql: string): Promise<QueryResult> {
  await loadRows(rows);
  return query(sql);
}

/** 直连数据源：SQL 交由服务端在目标数据库执行 */
async function runDbQuery(
  connectionId: string,
  sql: string,
): Promise<QueryResult> {
  const res = await fetch(`/api/datasources/${connectionId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  const data = (await res.json()) as QueryResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "查询失败");
  return { columns: data.columns, rows: data.rows };
}

/** 调用 /api/analyze，返回 { sql, summary, conversationId } */
async function callAnalyze(
  question: string,
  schema: DatasetColumn[],
  datasetId: string | null,
  conversationId: string | null,
  retryInfo?: AnalyzeRequest["retryInfo"],
  dialect?: Dialect,
  tableName?: string,
): Promise<AnalyzeResponse> {
  const body: AnalyzeRequest = {
    question,
    schema,
    datasetId: datasetId ?? undefined,
    conversationId: conversationId ?? undefined,
    retryInfo,
    dialect,
    tableName,
  };
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as AnalyzeResponse & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "请求失败");
  return data;
}
