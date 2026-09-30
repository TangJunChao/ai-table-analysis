import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 获取数据集的历史问答（会话 + 问数记录），用于历史回放 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const dataset = await prisma.dataset.findUnique({ where: { id } });
    if (!dataset) {
      return Response.json({ error: "数据集不存在" }, { status: 404 });
    }

    const conversations = await prisma.conversation.findMany({
      where: { datasetId: id },
      include: {
        queries: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            question: true,
            sql: true,
            status: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      queries: c.queries,
    }));

    return Response.json({ conversations: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * 删除历史记录：?queryId=xxx 删单条问数记录；?conversationId=xxx 删整个会话（含其下所有记录）。
 * 均校验记录属于当前数据集，避免跨数据集误删。
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const queryId = url.searchParams.get("queryId");
    const conversationId = url.searchParams.get("conversationId");

    const dataset = await prisma.dataset.findUnique({ where: { id } });
    if (!dataset) {
      return Response.json({ error: "数据集不存在" }, { status: 404 });
    }

    if (conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, datasetId: id },
      });
      if (!conv) {
        return Response.json({ error: "会话不存在" }, { status: 404 });
      }
      // 先删该会话下的问数记录（AnalysisQuery.conversation 为 SetNull，需显式清理）
      await prisma.analysisQuery.deleteMany({ where: { conversationId } });
      await prisma.conversation.delete({ where: { id: conversationId } });
      return Response.json({ ok: true });
    }

    if (queryId) {
      const q = await prisma.analysisQuery.findFirst({
        where: { id: queryId, datasetId: id },
      });
      if (!q) {
        return Response.json({ error: "记录不存在" }, { status: 404 });
      }
      await prisma.analysisQuery.delete({ where: { id: queryId } });
      return Response.json({ ok: true });
    }

    return Response.json(
      { error: "缺少 queryId 或 conversationId 参数" },
      { status: 400 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "服务器内部错误";
    return Response.json({ error: message }, { status: 500 });
  }
}
