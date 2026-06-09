import OpenAI from "openai";
import type { LLMClient, ChatMessage, CompletionOptions } from "../interface.js";

export class OpenAIAdapter implements LLMClient {
  private client: OpenAI;
  private defaultModel: string;

  constructor(model: string) {
    if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
      throw new Error(
        "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
      );
    }
    if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
      throw new Error(
        "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
      );
    }
    this.client = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
    this.defaultModel = model;
  }

  async chatCompletion(messages: ChatMessage[], opts?: CompletionOptions): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: opts?.model ?? this.defaultModel,
      max_completion_tokens: opts?.maxTokens,
      messages,
    });
    return response.choices[0]?.message?.content ?? "";
  }

  async visionCompletion(
    prompt: string,
    base64Image: string,
    mimeType: string,
    opts?: CompletionOptions,
  ): Promise<string> {
    const dataUrl = `data:${mimeType};base64,${base64Image}`;
    const response = await this.client.chat.completions.create({
      model: opts?.model ?? this.defaultModel,
      max_completion_tokens: opts?.maxTokens,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
          ],
        },
      ],
    });
    return response.choices[0]?.message?.content ?? "";
  }
}
