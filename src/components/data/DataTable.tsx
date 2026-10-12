"use client";

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import type { ColDef, ColumnVisibleEvent, FirstDataRenderedEvent } from "ag-grid-community";
// 新版主题：仅引入主题样式，不要再引 ag-grid.css（旧版基础样式）
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { RowData } from "@/lib/types";

// AG Grid 36 起按模块加载，注册全部社区模块（幂等）
ModuleRegistry.registerModules([AllCommunityModule]);

interface DataTableProps {
  rows: RowData[];
}

/** 分页大小选项 */
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

/** 根据样本行判断字段是否为数值型（用于右对齐 + 千分位格式化） */
function isNumericField(rows: RowData[], field: string): boolean {
  return rows.some((r) => typeof r[field] === "number");
}

/** 通用表格：基于 AG Grid，自动生成列定义，支持分页/筛选/列显隐/自适应列宽 */
export default function DataTable({ rows }: DataTableProps) {
  const allKeys = useMemo(
    () => (rows.length ? Object.keys(rows[0]) : []),
    [rows],
  );
  // 被隐藏的列（默认全部显示）
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [showColumnMenu, setShowColumnMenu] = useState(false);

  const columnDefs = useMemo<ColDef[]>(() => {
    // 行号列（固定在最左，不参与排序/筛选）
    const rowNumberCol: ColDef = {
      headerName: "#",
      valueGetter: (p) =>
        p.node?.rowIndex != null ? p.node.rowIndex + 1 : "",
      width: 64,
      minWidth: 64,
      pinned: "left",
      sortable: false,
      filter: false,
      floatingFilter: false,
      resizable: false,
      suppressHeaderMenuButton: true,
    };

    const dataCols: ColDef[] = allKeys.map((field) => {
      const numeric = isNumericField(rows, field);
      return {
        field,
        hide: hiddenKeys.has(field),
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 120,
        maxWidth: 360,
        cellStyle: numeric ? { textAlign: "right" } : undefined,
        valueFormatter: numeric
          ? (p) => {
              const v = p.value;
              return typeof v === "number" && Number.isFinite(v)
                ? v.toLocaleString()
                : String(v ?? "");
            }
          : undefined,
      };
    });

    return [rowNumberCol, ...dataCols];
  }, [allKeys, hiddenKeys, rows]);

  /** 列宽按内容自适应（首次渲染 + 列显隐变化后触发） */
  function autoSizeColumns(event: FirstDataRenderedEvent | ColumnVisibleEvent) {
    try {
      const cols = event.api.getColumns();
      if (cols?.length) {
        event.api.autoSizeColumns(cols.map((c) => c.getColId()));
      }
    } catch {
      /* 极端情况下忽略自适应失败 */
    }
  }

  function toggleColumn(field: string) {
    setHiddenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });
  }

  function resetColumns() {
    setHiddenKeys(new Set());
  }

  const visibleCount = allKeys.length - hiddenKeys.size;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="relative flex items-center gap-2">
          <button
            onClick={() => setShowColumnMenu((v) => !v)}
            className="rounded-lg border border-neutral-300 px-3 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            title="显示/隐藏列"
          >
            列显示（{visibleCount}/{allKeys.length}）
          </button>
          {showColumnMenu && (
            <div className="absolute left-0 top-full z-30 mt-1 max-h-64 w-52 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1.5 shadow-lg">
              {allKeys.map((k) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-neutral-50"
                >
                  <input
                    type="checkbox"
                    checked={!hiddenKeys.has(k)}
                    onChange={() => toggleColumn(k)}
                    className="accent-blue-600"
                  />
                  <span className="truncate">{k}</span>
                </label>
              ))}
            </div>
          )}
          <span className="text-xs text-neutral-400">
            共 {rows.length.toLocaleString()} 行
          </span>
        </div>
        {hiddenKeys.size > 0 && (
          <button
            onClick={resetColumns}
            className="text-xs text-neutral-400 hover:text-blue-600"
          >
            显示全部列
          </button>
        )}
      </div>

      <div className="ag-theme-quartz h-[360px] w-full">
        <AgGridReact
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, filter: true, resizable: true, floatingFilter: true }}
          animateRows={true}
          pagination={true}
          paginationPageSize={20}
          paginationPageSizeSelector={PAGE_SIZE_OPTIONS}
          statusBar={{
            statusPanels: [
              { statusPanel: "agTotalAndFilteredRowCountComponent" },
            ],
          }}
          onFirstDataRendered={autoSizeColumns}
          onColumnVisible={autoSizeColumns}
        />
      </div>
    </div>
  );
}
