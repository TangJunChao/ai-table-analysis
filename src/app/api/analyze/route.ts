import { generateText } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";
import type { AnalyzeRequest, AnalyzeResponse, Dialect } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 输出结构校验（与 LLM 提示词约定一致） */
const AnalysisOutput = z.object({
  sql: z.string().describe("回答用户问题的 SQL 查询，仅查询语句；intent 为 chat 时输出空字符串"),
  summary: z.string().describe("给用户的自然语言结论，用中文，简洁"),
  intent: z
    .enum(["table", "chart", "chat"])
    .default("table")
    .describe("AI 意图：table=出表、chart=出图、chat=闲聊（与数据无关）"),
  chartType: z
    .enum(["bar", "line", "pie"])
    .optional()
    .describe("用户明确要出图时输出：bar=柱状图、line=折线图、pie=饼图；否则省略"),
});

/**
 * AI 问数接口（Text-to-SQL 闭环的服务端部分）
 *
 * 流程：接收问题 + 表结构 → LLM 生成 DuckDB SQL 与结论
 *       →（可选）持久化会话 + 问数记录 → 返回结构化结果
 * SQL 的实际执行在浏览器端 DuckDB-WASM 完成（见 ChatPanel）。
 *
 * 兼容性说明：不使用 Output.object（其底层为 OpenAI json_schema，
 * DeepSeek 等部分端点不支持），改为文本输出 + 提示词限定 JSON + 手动解析校验。
 */
export async function POST(request: Request) {
  try {
    const body: AnalyzeRequest = await request.json();

    if (!body.question || typeof body.question !== "string") {
      return Response.json({ error: "缺少 question 参数" }, { status: 400 });
    }

    const schema = Array.isArray(body.schema) ? body.schema : [];
    const dialect: Dialect = body.dialect ?? "duckdb";
    const tableName = body.tableName ?? undefined;

    // —— 会话解析（多轮上下文 + 持久化），仅在关联已保存数据集时 ——
    let conversationId: string | null = null;
    let history: { question: string; sql: string }[] = [];
    let persistUser: { id: string } | null = null;
    if (body.datasetId) {
      try {
        persistUser = await ensureDemoUser();
        conversationId = body.conversationId ?? null;
        if (conversationId) {
          const exists = await prisma.conversation.findUnique({
            where: { id: conversationId },
          });
          if (!exists) conversationId = null;
        }
        if (!conversationId) {
          const conversation = await prisma.conversation.create({
            data: {
              datasetId: body.datasetId,
              userId: persistUser.id,
              title: body.question.slice(0, 40),
            },
          });
          conversationId = conversation.id;
        }
        // 拉取该会话最近几轮问答作为多轮上下文
        const prev = await prisma.analysisQuery.findMany({
          where: { conversationId },
          orderBy: { createdAt: "asc" },
          take: 8,
        });
        history = prev.map((q) => ({ question: q.question, sql: q.sql ?? "" }));
      } catch (err) {
        console.error("[analyze] 会话初始化失败:", err);
        conversationId = null;
      }
    }

    const { text } = await generateText({
      model: getModel(),
      system: buildSystemPrompt(schema, history, body.retryInfo, dialect, tableName),
      prompt: body.question,
    });

    const { sql, summary, intent, chartType } = parseAnalysisOutput(text);

    const result: AnalyzeResponse = { sql, summary, intent, chartType };

    // 持久化：问数记录（会话已在上方创建/复用）
    if (conversationId && persistUser && body.datasetId) {
      try {
        const query = await prisma.analysisQuery.create({
          data: {
            conversationId,
            datasetId: body.datasetId,
            userId: persistUser.id,
            question: body.question,
            sql,
            status: "success",
          },
        });
        result.queryId = query.id;
        result.conversationId = conversationId;
      } catch (err) {
        // 持久化失败不影响问数结果
        console.error("[analyze] 持久化失败:", err);
      }
    }

    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}

/** 解析并校验 LLM 输出（容错：代码块、前后多余文字） */
function parseAnalysisOutput(text: string): z.infer<typeof AnalysisOutput> {
  const parsed = AnalysisOutput.safeParse(extractJson(text));
  if (!parsed.success) {
    throw new Error(
      `AI 返回格式无法解析：${parsed.error.issues[0]?.message ?? "未知错误"}。原始输出：${text.slice(0, 200)}`,
    );
  }
  return parsed.data;
}

/** 从 LLM 输出中提取 JSON 对象 */
function extractJson(text: string): unknown {
  const trimmed = text.trim();
  // 去掉可能的 ```json ... ``` 代码块
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  try {
    return JSON.parse(candidate);
  } catch {
    // 退化：截取第一个 { 到最后一个 } 之间的内容
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }
    throw new Error("未找到有效的 JSON 对象");
  }
}

/** 各方言的 SQL 规则（表名、标识符引号、数值聚合） */
const DIALECT_RULES: Record<Dialect, string[]> = {
  duckdb: [
    "表名固定为 data",
    "字段名若含中文或特殊字符，SQL 中需要用双引号包裹",
    "对数值列做 SUM/AVG/MAX 等聚合时，使用 `TRY_CAST(\"列名\" AS DOUBLE)` 而不是直接引用或 CAST——数据中可能混入文本（如月份标签），TRY_CAST 会把无法转换的文本变成 NULL 而不是报错",
  ],
  sqlite: [
    "表名与表结构中的表名一致",
    "字段名若含中文或特殊字符，用双引号包裹",
    "SQLite 没有 TRY_CAST，数值聚合前请用 CAST(列名 AS REAL)，并注意排除非数值脏数据",
  ],
  postgres: [
    "表名与表结构中的表名一致",
    "字段名若含中文或特殊字符，用双引号包裹",
    "数值聚合用 CAST(列名 AS DOUBLE PRECISION)",
  ],
  mysql: [
    "表名与表结构中的表名一致",
    "字段名若含中文或特殊字符，用反引号包裹",
    "数值聚合用 CAST(列名 AS DECIMAL(20,2))",
  ],
};

/** 构造 LLM 系统提示词：注入表结构 + 对话历史 + 方言规则 + 可选修正指令 */
function buildSystemPrompt(
  schema: AnalyzeRequest["schema"],
  history: { question: string; sql: string }[],
  retryInfo: AnalyzeRequest["retryInfo"],
  dialect: Dialect = "duckdb",
  tableName?: string,
): string {
  const fields = schema.length
    ? schema
        .map((c) => {
          const stats = c.stats
            ? ` (min=${c.stats.min ?? "-"}, max=${c.stats.max ?? "-"}, 唯一值=${c.stats.unique ?? "-"}, 空值率=${c.stats.null_ratio ?? "-"})`
            : "";
          return `- ${c.name}（${c.data_type}）${stats}`;
        })
        .join("\n")
    : "（未提供表结构）";

  const historySection = history.length
    ? [
        "",
        "对话历史（此前同一会话中的问答，用于理解追问的上下文；若与当前问题无关可忽略）：",
        ...history.map(
          (h, i) =>
            `第${i + 1}轮\n用户：${h.question}\nSQL：${h.sql || "（无）"}`,
        ),
      ]
    : [];

  const retrySection = retryInfo
    ? [
        "",
        "你上一次生成的 SQL 执行失败，请根据错误修正后重新生成。",
        "上一版 SQL：",
        retryInfo.sql,
        "执行错误：",
        retryInfo.error,
        "重点检查：字段名是否与表结构完全一致、是否臆造了不存在的列、语法是否正确。",
      ]
    : [];

  return [
    `你是数据表格分析助手。用户有一张数据表，${tableName ? `表名为 ${tableName}` : "表名固定为 data"}。`,
    `请把用户的问题转换成${dialect === "duckdb" ? "DuckDB" : dialect} 兼容的 SQL 查询，并给出简洁的中文结论。`,
    "",
    "表结构：",
    fields,
    ...historySection,
    "",
    "规则：",
    "- **先判断用户意图（intent）**：",
    '  * "chat"：用户在闲聊/问候，或提问与这张数据表无关的内容（如"你好"、"你是谁"、"谢谢"），此时 sql 输出空字符串 ""，summary 给出友好简短的中文回复',
    '  * "chart"：用户明确要求以图表/可视化形式呈现结果（如"画个图"、"柱状图"、"饼图"、"折线图"、"占比"、"可视化"、"趋势图"），此时必须输出 chartType：占比/构成类分析选 pie，随时间变化选 line，其余对比选 bar；sql 输出能支撑该图表的数据查询（如按维度分组的汇总）',
    '  * "table"：默认情况，普通数据查询，只输出 SQL 与结论，不输出 chartType',
    "- 只生成 SELECT 查询，禁止 INSERT/UPDATE/DELETE/DDL",
    "- **只能使用上方表结构中存在的字段名**，禁止臆造或猜测不存在的列；若表结构为空，只使用问题中明确提到的字段名",
    ...DIALECT_RULES[dialect].map((r) => `- ${r}`),
    "- 结论用中文，控制在 2-3 句",
    ...retrySection,
    "",
    "输出要求：直接输出一个 JSON 对象，不要输出任何其他内容、不要用 markdown 代码块。格式如下：",
    '{"sql": "你的 SQL 语句", "summary": "你的中文结论", "intent": "table|chart|chat", "chartType": "可选：bar|line|pie"}',
  ].join("\n");
}
