import { GoogleGenAI } from "@google/genai";
import type { LLMClient, ChatMessage, CompletionOptions } from "../interface.js";

export class GeminiAdapter implements LLMClient {
  private client: GoogleGenAI;
  private defaultModel: string;

  constructor(model: string) {
    if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
      throw new Error(
        "AI_INTEGRATIONS_GEMINI_BASE_URL must be set. Did you forget to provision the Gemini AI integration?",
      );
    }
    if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
      throw new Error(
        "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Did you forget to provision the Gemini AI integration?",
      );
    }
    this.client = new GoogleGenAI({
      apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
      httpOptions: {
        apiVersion: "",
        baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
      },
    });
    this.defaultModel = model;
  }

  async chatCompletion(messages: ChatMessage[], opts?: CompletionOptions): Promise<string> {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");

    const systemInstruction = systemMessages.map((m) => m.content).join("\n\n");

    const contents = nonSystemMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const response = await this.client.models.generateContent({
      model: opts?.model ?? this.defaultModel,
      contents,
      config: {
        ...(systemInstruction ? { systemInstruction } : {}),
        ...(opts?.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      },
    });

    return response.text ?? "";
  }

  async visionCompletion(
    prompt: string,
    base64Image: string,
    mimeType: string,
    opts?: CompletionOptions,
  ): Promise<string> {
    const response = await this.client.models.generateContent({
      model: opts?.model ?? this.defaultModel,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64Image } },
            { text: prompt },
          ],
        },
      ],
      config: {
        ...(opts?.maxTokens ? { maxOutputTokens: opts.maxTokens } : {}),
      },
    });

    return response.text ?? "";
  }
}
