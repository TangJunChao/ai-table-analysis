# AI 表格分析工具（ai-table-analysis）

一个开箱即用的全栈 AI 数据分析应用：上传或直连数据 → 表格展示 → 用自然语言向 AI 问数（Text-to-SQL）→ 自动执行并回填表格与图表 → 透视、洞察、历史回放、导出。

## 功能特性

- **数据导入**：上传 CSV / Excel / JSON，自适应表头识别、类型推断、数值列脏数据清洗，兼容中文与日期格式
- **数据源直连**：连接 SQLite / PostgreSQL / MySQL，浏览表结构、预览数据、一键导入为数据集
- **AI 自然语言问数**：输入中文问题，LLM 自动生成 SQL 并在浏览器端 DuckDB 中执行，结果回填表格与图表
- **AI 意图识别**：自动判断问题是"出表 / 出图 / 闲聊"——闲聊不执行 SQL，要图则按指定类型（柱状/折线/饼图）渲染
- **智能图表推荐**：根据结果列结构自动推荐图表，支持柱状图、折线图、饼图（占比）
- **多轮追问**：会话级上下文，支持基于原始数据连续追问，不会因结果回填丢失原始列
- **透视表**：行维度 × 列维度 + SUM / AVG / COUNT / MAX / MIN 汇总
- **智能洞察**：自动生成趋势、异常、分布、数据质量等洞察卡片
- **历史回放**：会话与问数记录持久化，可一键重跑历史 SQL，支持删除单条记录或整个会话
- **结果导出**：查询结果一键导出为 Excel
- **数据安全**：行数据与数据库本地持久化（`data/` + SQLite），敏感配置不入库

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 前端框架 | Next.js 16（Turbopack） + React 19 + TypeScript + Tailwind CSS 4 |
| 数据表格 | AG Grid 36（社区版） |
| 图表 | ECharts 6 |
| SQL 执行（数据集） | DuckDB-WASM 1.32（浏览器端，本地化 wasm 资源） |
| LLM | Vercel AI SDK + DeepSeek（兼容 OpenAI 协议端点） |
| 持久化 | Prisma 6 + SQLite（可平滑迁移 Postgres） |
| 文件解析 / 导出 | SheetJS（xlsx 0.18） |
| 数据源直连 | node:sqlite / pg / mysql2 |

## 快速开始

### 环境要求

- Node.js 20+（建议 22）
- 一个支持 OpenAI 协议的大模型 API Key（默认 DeepSeek）

### 安装与启动

```bash
# 1. 克隆项目
git clone https://github.com/TangJunChao/ai-table-analysis.git
cd ai-table-analysis

# 2. 安装依赖
npm install

# 3. 配置环境变量（复制为 .env.local 并填写）
cp .env.example .env.local

# 4. 初始化数据库
npx prisma migrate dev

# 5. 启动开发服务器
npm run dev
```

访问 http://localhost:3000 即可使用。

### 环境变量（.env.local）

```bash
# LLM（DeepSeek 示例，可换任意 OpenAI 兼容端点）
LLM_API_KEY=sk-xxxxxxxxxxxxxxxx
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# 本地数据库（SQLite，迁移到 Postgres 时改成 postgresql://...）
DATABASE_URL=file:./dev.db
```

> `.env*`、`data/`、`prisma/*.db` 均已加入 `.gitignore`，请勿提交密钥。

## 使用说明

1. **导入数据**：点击右上角「上传 CSV / Excel」，或直接在「数据源直连」面板连接数据库并「导入为数据集」。
2. **AI 问数**：在右侧「AI 问数」输入框用中文提问，例如：
   - 出表：「按区域统计销售额总和并降序排列」
   - 出图：「画个饼图，看各区域销售额占比」
   - 闲聊：「你好」（直接回复，不执行 SQL）
3. **透视表 / 智能图表 / 智能洞察**：随当前数据实时更新。
4. **历史回放**：点击左侧历史问题可一键重跑；切换文档后 AI 问数对话自动清空。
5. **导出**：随时将当前结果导出为 Excel。

## 架构说明

- **数据集问数**：SQL 在浏览器端 DuckDB-WASM 执行（本地化 `public/duckdb/` 资源，无需外部 CDN），仅将列名 + 类型 + 统计信息发送给 LLM，原始数据不出浏览器。
- **数据源直连问数**：SQL 由服务端在目标数据库执行（强制 `SELECT`/`WITH` 并包裹子查询 `LIMIT`，防止误操作）。
- **多轮上下文**：问数记录按会话持久化，最近 8 轮问答作为 LLM 上下文，追问始终基于数据集原始 schema 与数据。

## 目录结构

```
src/
  app/
    page.tsx                  # 主页面（表格/透视/图表/问数/洞察/历史/数据源）
    api/
      analyze/                # AI 问数（Text-to-SQL + 意图识别）
      datasets/               # 数据集 CRUD / 历史记录
      charts/                 # 图表持久化
      insights/               # 智能洞察
      datasources/            # 数据源直连（连接/表/预览/查询/导入）
  components/
    data/                     # DataTable / ChartView / PivotPanel / DataSourcePanel
    ai/                       # ChatPanel / InsightPanel / HistoryPanel
  lib/                        # 解析、DuckDB、Prisma、存储、AI、导出、画像、直连驱动
prisma/schema.prisma          # 数据模型
public/duckdb/                # DuckDB-WASM 本地化资源
```

## 常用脚本

```bash
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run start        # 生产启动
npm run lint         # ESLint 检查
npm run db:generate  # 生成 Prisma Client
npm run db:migrate   # 执行数据库迁移
npm run db:studio    # 打开 Prisma Studio
```
