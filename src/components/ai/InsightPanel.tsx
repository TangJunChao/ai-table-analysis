"use client";

import { useState } from "react";
import type { DatasetColumn, InsightCard, RowData } from "@/lib/types";
import { buildProfile } from "@/lib/profile";

interface InsightPanelProps {
  /** 当前数据集行数据（用于构建数据画像） */
  rows: RowData[];
  /** 当前数据集列结构 */
  schema: DatasetColumn[];
}

const TYPE_LABEL: Record<InsightCard["type"], string> = {
  trend: "趋势",
  anomaly: "异常",
  distribution: "分布",
  quality: "质量",
  highlight: "亮点",
};

const TYPE_STYLE: Record<InsightCard["type"], string> = {
  trend: "bg-blue-50 text-blue-700",
  anomaly: "bg-red-50 text-red-700",
  distribution: "bg-emerald-50 text-emerald-700",
  quality: "bg-amber-50 text-amber-700",
  highlight: "bg-violet-50 text-violet-700",
};

/** 智能洞察面板：AI 自动扫描数据画像，生成洞察卡片 */
export default function InsightPanel({ rows, schema }: InsightPanelProps) {
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!rows.length || loading) return;
    setLoading(true);
    setError("");
    try {
      const profile = buildProfile(rows, schema);
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      setInsights(data.insights ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-600">智能洞察</h2>
        <button
          onClick={generate}
          disabled={!rows.length || loading}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          {loading ? "分析中…" : "生成洞察"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && !insights.length && !error && (
        <p className="text-sm text-neutral-400">
          让 AI 自动扫描当前数据，发现趋势、异常与亮点。
        </p>
      )}
      {insights.length > 0 && (
        <div className="max-h-80 space-y-2 overflow-y-auto">
          {insights.map((ins, i) => (
            <div
              key={i}
              className="rounded-lg border border-neutral-200 p-3 text-sm"
            >
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${TYPE_STYLE[ins.type]}`}
                >
                  {TYPE_LABEL[ins.type]}
                </span>
                <span className="font-medium text-neutral-800">{ins.title}</span>
              </div>
              <p className="text-neutral-600">{ins.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
