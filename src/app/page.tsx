"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EChartsOption } from "echarts";
import DataTable from "@/components/data/DataTable";
import ChartView from "@/components/data/ChartView";
import ChatPanel, { type ChatPanelHandle } from "@/components/ai/ChatPanel";
import HistoryPanel from "@/components/ai/HistoryPanel";
import InsightPanel from "@/components/ai/InsightPanel";
import PivotPanel from "@/components/data/PivotPanel";
import DataSourcePanel from "@/components/data/DataSourcePanel";
import { buildColumnsFromRows, parseFile } from "@/lib/parse";
import { recommendChart } from "@/lib/chart";
import { exportRowsToExcel } from "@/lib/export";
import type {
  DatasetColumn,
  Dialect,
  HistoryQueryItem,
  QueryResult,
  QueryResultMeta,
  RowData,
  SourceType,
} from "@/lib/types";

/** 演示用的示例销售数据 */
const DEMO_ROWS: RowData[] = [
  { 区域: "华东", 月份: "2026-01", 销售额: 1280, 利润: 342 },
  { 区域: "华东", 月份: "2026-02", 销售额: 1320, 利润: 360 },
  { 区域: "华南", 月份: "2026-01", 销售额: 980, 利润: 210 },
  { 区域: "华南", 月份: "2026-02", 销售额: 1120, 利润: 245 },
  { 区域: "华北", 月份: "2026-01", 销售额: 860, 利润: 158 },
  { 区域: "华北", 月份: "2026-02", 销售额: 940, 利润: 172 },
  { 区域: "西南", 月份: "2026-01", 销售额: 720, 利润: 121 },
  { 区域: "西南", 月份: "2026-02", 销售额: 790, 利润: 135 },
];

/** 根据行数据生成简易柱状图 option（取首个字符串列做分类、首个数值列做数值） */
function buildBarOption(rows: RowData[]): EChartsOption {
  const first = rows[0] ?? {};
  const keys = Object.keys(first);
  const catKey = keys.find((k) => typeof first[k] === "string") ?? keys[0];
  const valKey =
    keys.find((k) => typeof first[k] === "number") ?? keys[keys.length - 1];

  const cats = rows.map((r) => String(r[catKey] ?? ""));
  const vals = rows.map((r) => Number(r[valKey] ?? 0));

  return {
    tooltip: {},
    grid: { left: 48, right: 16, top: 32, bottom: 40 },
    xAxis: {
      type: "category",
      data: cats,
      axisLabel: { rotate: cats.length > 6 ? 30 : 0 },
    },
    yAxis: { type: "value" },
    series: [{ type: "bar", name: valKey, data: vals }],
  };
}

/** 根据文件名推断来源类型 */
function detectSourceType(name: string): SourceType {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  return "json";
}

interface SavedDataset {
  id: string;
  name: string;
  sourceType: string;
  status: string;
  rowCount: number;
  createdAt: string;
}

/** 直连数据源当前激活的上下文 */
interface LiveSource {
  connectionId: string;
  tableName: string;
  dialect: Dialect;
  sourceName: string;
}

export default function Home() {
  const [rows, setRows] = useState<RowData[]>(DEMO_ROWS);
  const [schema, setSchema] = useState<DatasetColumn[]>(() =>
    buildColumnsFromRows(DEMO_ROWS),
  );
  // 分析基准：数据集的原始数据与表结构。AI 问数/多轮追问始终基于它，
  // 问数结果回填只影响表格/图表显示（rows/schema），避免回填后丢失原始列导致 Binder 错误。
  const [baseRows, setBaseRows] = useState<RowData[]>(DEMO_ROWS);
  const [baseSchema, setBaseSchema] = useState<DatasetColumn[]>(() =>
    buildColumnsFromRows(DEMO_ROWS),
  );
  const [fileName, setFileName] = useState("示例销售数据");
  const [saved, setSaved] = useState<SavedDataset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chartOption, setChartOption] = useState<EChartsOption>(() =>
    buildBarOption(DEMO_ROWS),
  );
  const [historyKey, setHistoryKey] = useState(0);
  const [liveSource, setLiveSource] = useState<LiveSource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<ChatPanelHandle>(null);

  const refreshList = useCallback(async () => {
    try {
      const res = await fetch("/api/datasets");
      const data = await res.json();
      if (res.ok) setSaved(data.datasets ?? []);
    } catch {
      /* 静默失败，下次再试 */
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  async function handleFile(file: File) {
    try {
      const parsed = await parseFile(file);

      // 持久化：行数据落文件 + 元信息落库
      const res = await fetch("/api/datasets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: file.name,
          sourceType: detectSourceType(file.name),
          rows: parsed.rows,
          columns: parsed.columns,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "保存失败");

      setBaseRows(parsed.rows);
      setBaseSchema(parsed.columns);
      setRows(parsed.rows);
      setSchema(parsed.columns);
      setFileName(parsed.name);
      setActiveId(data.dataset.id);
      setLiveSource(null);
      setChartOption(buildBarOption(parsed.rows));
      setHistoryKey((k) => k + 1);
      chatRef.current?.clear(); // 切换文档：清空 AI 问数对话与上下文
      await refreshList();
    } catch (err) {
      alert(`解析/保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function loadDataset(id: string) {
    try {
      const res = await fetch(`/api/datasets/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "加载失败");
      setBaseRows(data.rows);
      setBaseSchema(data.columns);
      setRows(data.rows);
      setSchema(data.columns);
      setFileName(data.dataset.name);
      setActiveId(id);
      setLiveSource(null);
      setChartOption(buildBarOption(data.rows));
      setHistoryKey((k) => k + 1);
      chatRef.current?.clear(); // 切换文档：清空 AI 问数对话与上下文
    } catch (err) {
      alert(`加载失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function deleteDataset(id: string) {
    if (!confirm("确定删除该数据集？")) return;
    const res = await fetch(`/api/datasets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setSaved((prev) => prev.filter((d) => d.id !== id));
      if (activeId === id) {
        setBaseRows(DEMO_ROWS);
        setBaseSchema(buildColumnsFromRows(DEMO_ROWS));
        setRows(DEMO_ROWS);
        setSchema(buildColumnsFromRows(DEMO_ROWS));
        setFileName("示例销售数据");
        setActiveId(null);
        setChartOption(buildBarOption(DEMO_ROWS));
        setHistoryKey((k) => k + 1);
        chatRef.current?.clear(); // 删除当前文档回到示例：清空 AI 问数对话
      }
    }
  }

  /**
   * 问数结果回填：更新表格/图表显示数据与展示用 schema（透视表/洞察跟随显示结果）。
   * meta 携带 AI 意图与图表类型：intent 为 chart 时强制用 LLM 指定的图表类型出图。
   * 注意：AI 问数的分析基准（baseRows/baseSchema）保持为数据集原始数据，不受回填影响。
   */
  function handleQueryResult(result: QueryResult, meta?: QueryResultMeta) {
    setRows(result.rows);
    const cols = buildColumnsFromRows(result.rows);
    setSchema(cols);

    // 智能图表推荐：AI 明确要出图时强制其图表类型（如饼图），否则按列结构自动推断
    const rec = recommendChart(result.rows, cols, meta?.chartType);
    if (rec) {
      setChartOption(rec.option);
      if (activeId) {
        fetch("/api/charts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            datasetId: activeId,
            title: rec.title,
            chartType: rec.chartType,
            config: rec.option,
          }),
        }).catch(() => {
          /* 保存失败不影响展示 */
        });
      }
    } else {
      setChartOption(buildBarOption(result.rows));
    }
    setHistoryKey((k) => k + 1);
  }

  /** 历史回放：先加载数据集原始数据作为执行基准，再交给 ChatPanel 重跑历史 SQL */
  async function handleReplay(q: HistoryQueryItem) {
    if (!activeId || !q.sql) return;
    try {
      const res = await fetch(`/api/datasets/${activeId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "加载失败");
      // 历史 SQL 基于数据集原始表结构生成，必须用原始数据执行（而非当前显示的聚合结果）
      setRows(data.rows);
      setSchema(data.columns);
      setChartOption(buildBarOption(data.rows));
      await chatRef.current?.replay({
        question: q.question,
        sql: q.sql,
        rows: data.rows,
      });
    } catch (err) {
      alert(`重跑失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 激活一个数据源表：加载预览数据并切换到"直连"模式 */
  function handleActivateLive(source: {
    connectionId: string;
    tableName: string;
    dialect: Dialect;
    sourceName: string;
    rows: RowData[];
    columns: DatasetColumn[];
  }) {
    setBaseRows(source.rows);
    setBaseSchema(source.columns);
    setRows(source.rows);
    setSchema(source.columns);
    setFileName(`${source.sourceName} · ${source.tableName}`);
    setChartOption(buildBarOption(source.rows));
    setHistoryKey((k) => k + 1);
    setActiveId(null); // 直连模式不走数据集持久化
    setLiveSource({
      connectionId: source.connectionId,
      tableName: source.tableName,
      dialect: source.dialect,
      sourceName: source.sourceName,
    });
    chatRef.current?.clear(); // 切换数据源：清空 AI 问数对话与上下文
  }

  /** 退出直连模式，回到示例数据 */
  function exitLive() {
    setLiveSource(null);
    setActiveId(null);
    setBaseRows(DEMO_ROWS);
    setBaseSchema(buildColumnsFromRows(DEMO_ROWS));
    setRows(DEMO_ROWS);
    setSchema(buildColumnsFromRows(DEMO_ROWS));
    setFileName("示例销售数据");
    setChartOption(buildBarOption(DEMO_ROWS));
    chatRef.current?.clear(); // 切换数据源：清空 AI 问数对话与上下文
  }

  /** 数据源表导入为数据集后：刷新列表并自动加载新数据集 */
  function handleImported(datasetId: string) {
    refreshList();
    loadDataset(datasetId);
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">AI 表格分析</h1>
          <p className="text-sm text-neutral-500">
            当前数据集：{fileName}（{rows.length.toLocaleString()} 行）
            {liveSource && (
              <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                直连 {liveSource.sourceName}（{liveSource.dialect}）
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportRowsToExcel(rows, fileName)}
            disabled={rows.length === 0}
            className="shrink-0 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 disabled:opacity-40"
          >
            导出 Excel
          </button>
          {liveSource && (
            <button
              onClick={exitLive}
              className="shrink-0 rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50"
            >
              退出数据源
            </button>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
          >
            上传 CSV / Excel
          </button>
        </div>
      </header>

      <section className="rounded-lg border border-neutral-200 p-3">
        <h2 className="mb-2 text-sm font-medium text-neutral-600">
          已保存数据集（{saved.length}）
        </h2>
        {saved.length === 0 ? (
          <p className="text-sm text-neutral-400">
            暂无保存记录，上传文件后会自动持久化到本地数据库。
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {saved.map((d) => (
              <li
                key={d.id}
                className={`group flex items-center gap-2 rounded-full border px-3 py-1 text-sm ${
                  d.id === activeId
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : "border-neutral-200 text-neutral-700 hover:bg-neutral-50"
                }`}
              >
                <button onClick={() => loadDataset(d.id)} className="truncate">
                  {d.name}（{d.rowCount.toLocaleString()} 行）
                </button>
                <button
                  onClick={() => deleteDataset(d.id)}
                  className="text-neutral-400 hover:text-red-500"
                  title="删除"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-600">数据表</h2>
            <DataTable rows={rows} />
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-600">透视表</h2>
            <PivotPanel rows={rows} schema={schema} />
          </div>
          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-600">
              智能图表
            </h2>
            <ChartView option={chartOption} />
          </div>
        </div>
        <aside className="flex flex-col gap-6">
          <div>
            <h2 className="mb-2 text-sm font-medium text-neutral-600">AI 问数</h2>
            <ChatPanel
              ref={chatRef}
              schema={baseSchema}
              rows={baseRows}
              datasetId={liveSource ? null : activeId}
              execution={liveSource}
              onResult={handleQueryResult}
            />
          </div>
          <InsightPanel rows={rows} schema={schema} />
          <HistoryPanel
            datasetId={liveSource ? null : activeId}
            refreshKey={historyKey}
            onReplay={handleReplay}
          />
          <DataSourcePanel
            onActivate={handleActivateLive}
            onImported={handleImported}
          />
        </aside>
      </section>
    </main>
  );
}
