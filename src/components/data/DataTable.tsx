"use client";

import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, AllCommunityModule } from "ag-grid-community";
import type { ColDef } from "ag-grid-community";
// 新版主题：仅引入主题样式，不要再引 ag-grid.css（旧版基础样式）
import "ag-grid-community/styles/ag-theme-quartz.css";
import type { RowData } from "@/lib/types";

// AG Grid 36 起按模块加载，注册全部社区模块（幂等）
ModuleRegistry.registerModules([AllCommunityModule]);

interface DataTableProps {
  rows: RowData[];
}

/** 通用表格：基于 AG Grid，自动根据首行生成列定义 */
export default function DataTable({ rows }: DataTableProps) {
  const columnDefs = useMemo<ColDef[]>(() => {
    const keys = rows.length ? Object.keys(rows[0]) : [];
    return keys.map((field) => ({
      field,
      sortable: true,
      filter: true,
      resizable: true,
      flex: 1,
      minWidth: 120,
    }));
  }, [rows]);

  return (
    <div className="ag-theme-quartz h-[360px] w-full">
      <AgGridReact
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        animateRows={true}
      />
    </div>
  );
}
