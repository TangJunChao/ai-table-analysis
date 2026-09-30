import { generateText } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai";
import type { DataProfile, InsightCard } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 洞察卡片结构校验 */
const InsightOutput = z.array(
  z.object({
    type: z.enum(["trend", "anomaly", "distribution", "quality", "highlight"]),
    title: z.string(),
    content: z.string(),
  }),
);

/**
 * 智能洞察接口：接收数据画像（统计信息 + Top 值，不含原始数据），
 * 由 LLM 生成洞察卡片列表。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { profile?: DataProfile };
    if (!body.profile || typeof body.profile !== "object") {
      return Response.json({ error: "缺少 profile 参数" }, { status: 400 });
    }

    const { text } = await generateText({
      model: getModel(),
      system: buildSystemPrompt(),
      prompt: buildPrompt(body.profile),
    });

    const insights = parseInsightOutput(text);

    return Response.json({ insights });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}

function parseInsightOutput(text: string): InsightCard[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : trimmed).trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("[");
    const end = candidate.lastIndexOf("]");
    if (start < 0 || end <= start) {
      throw new Error("AI 输出中未找到 JSON 数组");
    }
    parsed = JSON.parse(candidate.slice(start, end + 1));
  }

  const result = InsightOutput.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `AI 返回格式无法解析：${result.error.issues[0]?.message ?? "未知错误"}`,
    );
  }
  return result.data;
}

function buildSystemPrompt(): string {
  return [
    "你是资深数据分析师。用户会给你一份数据画像（表格的统计摘要，不含原始数据）。",
    "请找出数据中最值得关注的信息，生成 3-5 条洞察卡片。",
    "",
    "洞察类型 type 只能是以下之一：",
    "- trend：趋势或变化（如时间维度上的增长/下降、Top 项变化）",
    "- anomaly：异常（如极端值、与其他项差距悬殊、异常集中）",
    "- distribution：分布特征（如某几项占比过高、集中度高）",
    "- quality：数据质量（如空值比例高、唯一值异常）",
    "- highlight：值得注意的亮点（如最高/最低、最大贡献者）",
    "",
    "要求：",
    "- title 简短（不超过 15 字）",
    "- content 用中文，1-2 句，必须引用画像中的具体数字",
    "- 不要编造画像中不存在的信息",
    "- 按重要程度排序",
    "",
    "输出要求：直接输出一个 JSON 数组，不要输出任何其他内容、不要用 markdown 代码块。",
    '格式：[{"type":"trend","title":"...","content":"..."}]',
  ].join("\n");
}

function buildPrompt(profile: DataProfile): string {
  const lines = profile.columns.map((c) => {
    const parts = [`${c.name}(${c.data_type})`, `空值=${c.nulls}`, `唯一值=${c.unique}`];
    if (c.min != null && c.max != null) parts.push(`范围=${c.min}~${c.max}`);
    if (c.avg != null) parts.push(`均值=${c.avg}`);
    if (c.sum != null) parts.push(`合计=${c.sum}`);
    if (c.minDate && c.maxDate) parts.push(`日期范围=${c.minDate}~${c.maxDate}`);
    if (c.top?.length) {
      parts.push(
        `Top值=${c.top.map((t) => `${t.value}(${t.count}次)`).join("、")}`,
      );
    }
    return `- ${parts.join("，")}`;
  });

  return [
    `总行数：${profile.rowCount.toLocaleString()}`,
    "",
    "各列画像：",
    ...lines,
  ].join("\n");
}
