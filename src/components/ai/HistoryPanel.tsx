"use client";

import { useCallback, useEffect, useState } from "react";
import type { HistoryConversation, HistoryQueryItem } from "@/lib/types";

interface HistoryPanelProps {
  /** 当前数据集 id（为 null 时显示空态） */
  datasetId: string | null;
  /** 点击一条历史记录：回放该次问数 */
  onReplay: (query: HistoryQueryItem) => void;
  /** 版本号：问数成功后递增，用于刷新列表 */
  refreshKey?: number;
}

/** 历史回放面板：展示某数据集的会话与问数记录，点击可一键重跑 */
export default function HistoryPanel({
  datasetId,
  onReplay,
  refreshKey = 0,
}: HistoryPanelProps) {
  const [conversations, setConversations] = useState<HistoryConversation[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!datasetId) {
      setConversations([]);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/datasets/${datasetId}/history`);
      const data = await res.json();
      if (res.ok) setConversations(data.conversations ?? []);
    } catch {
      /* 静默失败 */
    } finally {
      setLoading(false);
    }
  }, [datasetId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  /** 删除单条问数记录 */
  async function handleDeleteQuery(queryId: string) {
    if (!datasetId) return;
    await fetch(`/api/datasets/${datasetId}/history?queryId=${queryId}`, {
      method: "DELETE",
    });
    load();
  }

  /** 删除整个会话（含其下所有记录） */
  async function handleDeleteConversation(conversationId: string) {
    if (!datasetId) return;
    if (!confirm("确定删除整个会话及其所有问答记录？")) return;
    await fetch(
      `/api/datasets/${datasetId}/history?conversationId=${conversationId}`,
      { method: "DELETE" },
    );
    load();
  }

  const total = conversations.reduce(
    (sum, c) => sum + c.queries.length,
    0,
  );

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-neutral-600">
        历史回放（{total} 条）
      </h2>
      <div className="max-h-72 overflow-y-auto rounded-lg border border-neutral-200 p-2 text-sm">
        {!datasetId ? (
          <p className="p-1 text-neutral-400">加载已保存数据集后显示历史问答。</p>
        ) : loading ? (
          <p className="p-1 text-neutral-400">加载中…</p>
        ) : conversations.length === 0 ? (
          <p className="p-1 text-neutral-400">暂无历史问答。</p>
        ) : (
          <div className="space-y-3">
            {conversations.map((c) => (
              <div key={c.id} className="space-y-1">
                <div className="group flex items-center justify-between gap-1">
                  <p className="truncate text-xs font-medium text-neutral-500">
                    {c.title ?? "未命名会话"}
                  </p>
                  <button
                    onClick={() => handleDeleteConversation(c.id)}
                    className="hidden shrink-0 text-xs text-neutral-400 hover:text-red-500 group-hover:inline"
                    title="删除整个会话"
                  >
                    删除
                  </button>
                </div>
                {c.queries.map((q) => (
                  <div
                    key={q.id}
                    onClick={() => {
                      if (q.sql && q.status === "success") onReplay(q);
                    }}
                    title={q.sql ? "点击重新执行该查询" : "该记录无 SQL"}
                    className={`group flex w-full items-center justify-between gap-1 rounded px-2 py-1 text-left ${
                      q.sql && q.status === "success"
                        ? "cursor-pointer text-neutral-800 hover:bg-blue-50"
                        : "cursor-not-allowed opacity-40"
                    }`}
                  >
                    <span className="truncate">{q.question}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteQuery(q.id);
                      }}
                      className="hidden shrink-0 text-neutral-400 hover:text-red-500 group-hover:inline"
                      title="删除该条记录"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
