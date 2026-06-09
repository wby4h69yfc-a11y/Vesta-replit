export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
}

export interface LLMClient {
  chatCompletion(messages: ChatMessage[], opts?: CompletionOptions): Promise<string>;
  visionCompletion(
    prompt: string,
    base64Image: string,
    mimeType: string,
    opts?: CompletionOptions,
  ): Promise<string>;
}
