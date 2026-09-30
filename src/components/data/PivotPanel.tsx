"use client";

import { useEffect, useMemo, useState } from "react";
import type { DatasetColumn, RowData } from "@/lib/types";

interface PivotPanelProps {
  /** 当前数据集行数据（在浏览器端做透视计算） */
  rows: RowData[];
  /** 当前数据集列结构（用于生成维度/数值下拉选项） */
  schema: DatasetColumn[];
}

type Agg = "SUM" | "AVG" | "COUNT" | "MAX" | "MIN";

interface PivotResult {
  columns: string[];
  rows: RowData[];
}

const AGGS: Agg[] = ["SUM", "AVG", "COUNT", "MAX", "MIN"];
const MAX_PIVOT_VALUES = 50;

/** 纯 JS 透视计算：行维度 × 列维度 × 聚合 */
function pivotRows(
  rows: RowData[],
  rowDim: string,
  pivotCol: string,
  measure: string,
  agg: Agg,
): PivotResult {
  const pivotValues: string[] = [];
  const seenPivot = new Set<string>();
  const rowOrder: string[] = [];
  // rowKey -> pivotValue -> 聚合累加器
  const data = new Map<
    string,
    Map<string, { sum: number; count: number; max: number; min: number }>
  >();

  for (const r of rows) {
    const rk = String(r[rowDim] ?? "(空)");
    const pv = String(r[pivotCol] ?? "(空)");
    let rowMap = data.get(rk);
    if (!rowMap) {
      rowMap = new Map();
      data.set(rk, rowMap);
      rowOrder.push(rk);
    }
    if (!seenPivot.has(pv)) {
      seenPivot.add(pv);
      pivotValues.push(pv);
    }
    let cell = rowMap.get(pv);
    if (!cell) {
      cell = { sum: 0, count: 0, max: -Infinity, min: Infinity };
      rowMap.set(pv, cell);
    }
    cell.count++;
    const v = Number(r[measure]);
    if (Number.isFinite(v)) {
      cell.sum += v;
      if (v > cell.max) cell.max = v;
      if (v < cell.min) cell.min = v;
    }
  }

  const limit = Math.min(pivotValues.length, MAX_PIVOT_VALUES);
  const columns = [rowDim, ...pivotValues.slice(0, limit)];
  const out: RowData[] = rowOrder.map((rk) => {
    const rowMap = data.get(rk)!;
    const row: RowData = { [rowDim]: rk };
    for (const pv of pivotValues.slice(0, limit)) {
      const c = rowMap.get(pv);
      if (!c || c.count === 0) {
        row[pv] = null;
        continue;
      }
      switch (agg) {
        case "SUM":
          row[pv] = Math.round(c.sum * 100) / 100;
          break;
        case "AVG":
          row[pv] = Math.round((c.sum / c.count) * 100) / 100;
          break;
        case "COUNT":
          row[pv] = c.count;
          break;
        case "MAX":
          row[pv] = c.max === -Infinity ? null : c.max;
          break;
        case "MIN":
          row[pv] = c.min === Infinity ? null : c.min;
          break;
      }
    }
    return row;
  });

  return { columns, rows: out };
}

/** 透视表面板：选择行/列维度与聚合方式，交叉统计当前数据 */
export default function PivotPanel({ rows, schema }: PivotPanelProps) {
  const dimCols = useMemo(
    () => schema.filter((c) => c.data_type === "string" || c.data_type === "date"),
    [schema],
  );
  const stringCols = useMemo(
    () => schema.filter((c) => c.data_type === "string"),
    [schema],
  );
  const numCols = useMemo(
    () => schema.filter((c) => c.data_type === "number"),
    [schema],
  );

  const [rowDim, setRowDim] = useState("");
  const [pivotCol, setPivotCol] = useState("");
  const [measure, setMeasure] = useState("");
  const [agg, setAgg] = useState<Agg>("SUM");
  const [result, setResult] = useState<PivotResult | null>(null);
  const [message, setMessage] = useState("");

  // 数据集/表结构变化时，重置为默认选项并清空上次结果
  useEffect(() => {
    const fr = dimCols[0]?.name ?? "";
    const fp = stringCols[0]?.name ?? "";
    const fm = numCols[0]?.name ?? "";
    if (fr) setRowDim(fr);
    if (fp) setPivotCol(fp);
    if (fm) setMeasure(fm);
    setResult(null);
    setMessage("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimCols, stringCols, numCols]);

  function run() {
    if (!rowDim || !pivotCol || !measure || !rows.length) {
      setMessage("请选择行维度、列维度和数值列");
      return;
    }
    const res = pivotRows(rows, rowDim, pivotCol, measure, agg);
    setResult(res);
    setMessage("");
  }

  const selectCls =
    "rounded-md border border-neutral-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label className="flex items-center gap-1">
          行维度
          <select value={rowDim} onChange={(e) => setRowDim(e.target.value)} className={selectCls}>
            {dimCols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          列维度
          <select value={pivotCol} onChange={(e) => setPivotCol(e.target.value)} className={selectCls}>
            {stringCols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          数值
          <select value={measure} onChange={(e) => setMeasure(e.target.value)} className={selectCls}>
            {numCols.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          聚合
          <select
            value={agg}
            onChange={(e) => setAgg(e.target.value as Agg)}
            className={selectCls}
          >
            {AGGS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <button
          onClick={run}
          disabled={!rowDim || !pivotCol || !measure}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
        >
          生成透视
        </button>
      </div>

      {message && <p className="text-sm text-amber-600">{message}</p>}

      {result && (
        <div className="max-h-72 overflow-auto rounded-lg border border-neutral-200">
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 bg-neutral-100">
              <tr>
                {result.columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap border border-neutral-200 px-2 py-1 text-left font-medium"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r, i) => (
                <tr key={i} className="even:bg-neutral-50">
                  {result.columns.map((c) => (
                    <td key={c} className="border border-neutral-200 px-2 py-1 whitespace-nowrap">
                      {r[c] == null ? "" : String(r[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
