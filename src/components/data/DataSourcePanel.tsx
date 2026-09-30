"use client";

import { useCallback, useEffect, useState } from "react";
import type { DatasetColumn, Dialect, RowData } from "@/lib/types";

interface SavedSource {
  id: string;
  name: string;
  type: string;
  createdAt: string;
}

interface DataSourcePanelProps {
  /** 激活一个数据源表作为当前分析对象 */
  onActivate: (source: {
    connectionId: string;
    tableName: string;
    dialect: Dialect;
    sourceName: string;
    rows: RowData[];
    columns: DatasetColumn[];
  }) => void;
  /** 导入为数据集成功后回调（返回新数据集 id） */
  onImported?: (datasetId: string) => void;
}

type FormState = { name: string; type: Dialect; url: string } | null;

/** 数据源直连面板：连接 Postgres/MySQL/SQLite，浏览表并激活为当前数据 */
export default function DataSourcePanel({
  onActivate,
  onImported,
}: DataSourcePanelProps) {
  const [sources, setSources] = useState<SavedSource[]>([]);
  const [form, setForm] = useState<FormState>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [tables, setTables] = useState<Record<string, string[]>>({});
  const [loadingTables, setLoadingTables] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null);
  const [importing, setImporting] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/datasources");
      const data = await res.json();
      if (res.ok) setSources(data.sources ?? []);
    } catch {
      /* 静默 */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function saveSource() {
    if (!form || !form.url.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/datasources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存失败");
      setForm(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function loadTables(id: string) {
    if (tables[id] !== undefined) return;
    setLoadingTables(id);
    try {
      const res = await fetch(`/api/datasources/${id}/tables`);
      const data = await res.json();
      if (res.ok) {
        setTables((prev) => ({ ...prev, [id]: data.tables ?? [] }));
      } else {
        setError(data.error ?? "加载表失败");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTables(null);
    }
  }

  async function previewTable(source: SavedSource, table: string) {
    const key = `${source.id}:${table}`;
    setLoadingPreview(key);
    setError("");
    try {
      const res = await fetch(`/api/datasources/${source.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table, limit: 500 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "预览失败");
      onActivate({
        connectionId: source.id,
        tableName: table,
        dialect: source.type as Dialect,
        sourceName: source.name,
        rows: data.rows,
        columns: data.columns,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingPreview(null);
    }
  }

  /** 把表导入为持久化数据集（复用数据集存储流程） */
  async function importTable(source: SavedSource, table: string) {
    const key = `${source.id}:${table}`;
    setImporting(key);
    setError("");
    try {
      const res = await fetch(`/api/datasources/${source.id}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "导入失败");
      onImported?.(data.dataset.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(null);
    }
  }

  async function deleteSource(id: string) {
    if (!confirm("确定删除该数据源连接？")) return;
    const res = await fetch(`/api/datasources/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSources((prev) => prev.filter((s) => s.id !== id));
      setTables((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }

  const inputCls =
    "w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-600">数据源直连</h2>
        <button
          onClick={() =>
            setForm(form ? null : { name: "", type: "sqlite", url: "" })
          }
          className="rounded-md border border-neutral-300 px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          {form ? "取消" : "添加连接"}
        </button>
      </div>

      {form && (
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          <input
            className={inputCls}
            placeholder="名称（如 本地销售库）"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <select
            className={inputCls}
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as Dialect })
            }
          >
            <option value="sqlite">SQLite</option>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </select>
          <input
            className={inputCls}
            placeholder={
              form.type === "sqlite"
                ? "sqlite:./data/mydb.db"
                : form.type === "postgres"
                  ? "postgres://user:pass@host:5432/dbname"
                  : "mysql://user:pass@host:3306/dbname"
            }
            value={form.url}
            onChange={(e) => setForm({ ...form, url: e.target.value })}
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            onClick={saveSource}
            disabled={saving || !form.url.trim()}
            className="w-full rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          >
            {saving ? "测试并保存中…" : "测试连接并保存"}
          </button>
        </div>
      )}

      {!form && error && <p className="text-xs text-red-600">{error}</p>}

      {sources.length === 0 && !form ? (
        <p className="text-sm text-neutral-400">
          添加数据库连接后，可选择表作为分析对象。
        </p>
      ) : (
        <ul className="space-y-1 text-sm">
          {sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-neutral-200">
              <div className="flex items-center justify-between gap-2 px-3 py-2">
                <button
                  onClick={() => loadTables(s.id)}
                  className="flex-1 truncate text-left hover:text-blue-600"
                >
                  {s.name}
                  <span className="ml-2 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                    {s.type}
                  </span>
                </button>
                <button
                  onClick={() => deleteSource(s.id)}
                  className="text-neutral-400 hover:text-red-500"
                  title="删除连接"
                >
                  ×
                </button>
              </div>
              {loadingTables === s.id && (
                <p className="px-3 pb-2 text-xs text-neutral-400">加载表…</p>
              )}
              {tables[s.id] && (
                <div className="flex max-h-40 flex-col gap-1 overflow-y-auto border-t border-neutral-100 p-2">
                  {tables[s.id].length === 0 ? (
                    <p className="text-xs text-neutral-400">该库没有表</p>
                  ) : (
                    tables[s.id].map((t) => {
                      const isImporting = importing === `${s.id}:${t}`;
                      return (
                        <div
                          key={t}
                          className="flex items-center gap-1 rounded px-1 hover:bg-blue-50"
                        >
                          <button
                            onClick={() => previewTable(s, t)}
                            disabled={loadingPreview === `${s.id}:${t}`}
                            className="flex-1 truncate rounded px-2 py-1 text-left disabled:opacity-50"
                          >
                            {t}
                            {loadingPreview === `${s.id}:${t}` && " 加载中…"}
                          </button>
                          <button
                            onClick={() => importTable(s, t)}
                            disabled={isImporting}
                            title="导入为数据集（持久化保存）"
                            className="shrink-0 rounded px-1.5 py-0.5 text-xs text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            {isImporting ? "导入中…" : "导入"}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
