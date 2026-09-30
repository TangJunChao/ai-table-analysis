import type { EChartsOption } from "echarts";
import type { ChartType, DatasetColumn, RowData } from "./types";

export type { ChartType };

export interface ChartRecommendation {
  chartType: ChartType;
  title: string;
  option: EChartsOption;
}

/**
 * 智能图表推荐：基于查询结果的列结构 + 数据，用规则自动选择图表类型。
 * - 维度列为日期/时间 → 折线图（趋势）
 * - 一个维度 + 单个数值 → 柱状图
 * - 一个维度 + 多个数值 → 多系列柱状图
 * - 无维度列时退化为按首个字段分组的柱状图
 *
 * @param forceType AI 意图识别明确要出图时传入的图表类型（如饼图），覆盖自动推断。
 */
export function recommendChart(
  rows: RowData[],
  columns: DatasetColumn[],
  forceType?: ChartType,
): ChartRecommendation | null {
  if (!rows.length) return null;

  const dimCol =
    columns.find((c) => c.data_type === "date") ??
    columns.find((c) => c.data_type === "string");
  const numCols = columns.filter((c) => c.data_type === "number");

  const dimName = dimCol?.name ?? Object.keys(rows[0])[0];
  const measureNames =
    numCols.length > 0
      ? numCols.map((c) => c.name)
      : [Object.keys(rows[0])[Object.keys(rows[0]).length - 1]];

  // AI 明确要的图表类型优先；否则按规则自动推断
  let chartType: ChartType =
    forceType ??
    ((dimCol?.data_type === "date" || /(日期|时间|年月|date|time)/i.test(dimName))
      ? "line"
      : "bar");

  // 饼图：适合"占比 / 构成"类分析（仅用首个数值列）
  if (chartType === "pie") {
    const measureName = measureNames[0];
    const data = rows.map((r) => ({
      name: String(r[dimName] ?? ""),
      value: Number(r[measureName]),
    }));
    const option: EChartsOption = {
      title: {
        text: `${dimName} 占比分布`,
        left: "center",
        textStyle: { fontSize: 13 },
      },
      tooltip: { trigger: "item", formatter: "{b}: {c} ({d}%)" },
      legend: { bottom: 0 },
      series: [
        {
          type: "pie",
          radius: ["35%", "65%"],
          data,
          label: { formatter: "{b}: {d}%" },
        },
      ],
    };
    return { chartType: "pie", title: `${dimName} 占比分布`, option };
  }

  // 最多取 30 个分类，避免图表过密
  const sample = rows.slice(0, 30);
  const categories = sample.map((r) => String(r[dimName] ?? ""));
  const series = measureNames.map((name) => ({
    name,
    type: chartType,
    data: sample.map((r) => {
      const v = Number(r[name]);
      return Number.isFinite(v) ? v : 0;
    }),
  }));

  const option: EChartsOption = {
    title: { text: `${dimName} 与 ${measureNames[0]} 分析`, left: "center", textStyle: { fontSize: 13 } },
    tooltip: { trigger: "axis" },
    legend: measureNames.length > 1 ? { bottom: 0 } : undefined,
    grid: {
      left: 56,
      right: 16,
      top: 32,
      bottom: measureNames.length > 1 ? 48 : 40,
    },
    xAxis: {
      type: "category",
      data: categories,
      axisLabel: { rotate: categories.length > 6 ? 30 : 0 },
    },
    yAxis: { type: "value" },
    series,
  };

  return { chartType, title: `${dimName} vs ${measureNames[0]}`, option };
}
