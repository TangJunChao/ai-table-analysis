import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

/**
 * LLM Provider 封装（服务端使用）
 *
 * 支持任意 OpenAI 兼容协议端点：
 * - OpenAI:  https://api.openai.com/v1
 * - DeepSeek: https://api.deepseek.com/v1
 * - Moonshot: https://api.moonshot.cn/v1
 * - 本地 Ollama: http://localhost:11434/v1
 *
 * 通过环境变量配置，见 .env.example
 */
function createProvider() {
  return createOpenAI({
    apiKey: process.env.LLM_API_KEY,
    baseURL: process.env.LLM_BASE_URL ?? "https://api.openai.com/v1",
    name: "llm",
  });
}

/** 获取默认模型实例；未配置 API Key 时抛出明确错误 */
export function getModel(): LanguageModel {
  if (!process.env.LLM_API_KEY) {
    throw new Error(
      "缺少 LLM_API_KEY 环境变量，请在 .env.local 中配置后再调用 AI 能力",
    );
  }
  const modelId = process.env.LLM_MODEL ?? "gpt-4o-mini";
  return createProvider().chat(modelId);
}
