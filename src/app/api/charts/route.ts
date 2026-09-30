import { prisma } from "@/lib/db";
import { ensureDemoUser } from "@/lib/demo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 保存一张图表（AI 推荐或用户创建，存 ECharts 配置到 charts 表） */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { datasetId, title, chartType, config } = body as {
      datasetId?: string;
      title?: string;
      chartType?: string;
      config?: unknown;
    };

    if (!datasetId || !chartType || !config) {
      return Response.json(
        { error: "缺少 datasetId / chartType / config 参数" },
        { status: 400 },
      );
    }

    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetId },
    });
    if (!dataset) {
      return Response.json({ error: "数据集不存在" }, { status: 404 });
    }

    const user = await ensureDemoUser();
    const chart = await prisma.chart.create({
      data: {
        datasetId,
        userId: user.id,
        title: title ?? "智能推荐图表",
        chartType,
        config: config as object,
      },
    });

    return Response.json({ chart }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
