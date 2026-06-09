import Anthropic from "@anthropic-ai/sdk";
import type { LLMClient, ChatMessage, CompletionOptions } from "../interface.js";

export class AnthropicAdapter implements LLMClient {
  private client: Anthropic;
  private defaultModel: string;

  constructor(model: string) {
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL) {
      throw new Error(
        "AI_INTEGRATIONS_ANTHROPIC_BASE_URL must be set. Did you forget to provision the Anthropic AI integration?",
      );
    }
    if (!process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
      throw new Error(
        "AI_INTEGRATIONS_ANTHROPIC_API_KEY must be set. Did you forget to provision the Anthropic AI integration?",
      );
    }
    this.client = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
    });
    this.defaultModel = model;
  }

  async chatCompletion(messages: ChatMessage[], opts?: CompletionOptions): Promise<string> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const systemText = systemMessages.map((m) => m.content).join("\n\n");

    const response = await this.client.messages.create({
      model: opts?.model ?? this.defaultModel,
      max_tokens: opts?.maxTokens ?? 8192,
      ...(systemText ? { system: systemText } : {}),
      messages: nonSystemMessages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const block = response.content[0];
    return block?.type === "text" ? block.text : "";
  }

  async visionCompletion(
    prompt: string,
    base64Image: string,
    mimeType: string,
    opts?: CompletionOptions,
  ): Promise<string> {
    const validMediaTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
    type AnthropicMediaType = (typeof validMediaTypes)[number];
    const mediaType: AnthropicMediaType = validMediaTypes.includes(mimeType as AnthropicMediaType)
      ? (mimeType as AnthropicMediaType)
      : "image/jpeg";

    const response = await this.client.messages.create({
      model: opts?.model ?? this.defaultModel,
      max_tokens: opts?.maxTokens ?? 8192,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64Image },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const block = response.content[0];
    return block?.type === "text" ? block.text : "";
  }
}
