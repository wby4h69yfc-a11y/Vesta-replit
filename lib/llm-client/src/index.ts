export type { LLMClient, ChatMessage, CompletionOptions } from "./interface.js";

import type { LLMClient } from "./interface.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { AnthropicAdapter } from "./providers/anthropic.js";
import { GeminiAdapter } from "./providers/gemini.js";
import { OpenRouterAdapter } from "./providers/openrouter.js";

type Provider = "openai" | "anthropic" | "gemini" | "openrouter";

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022",
  gemini: "gemini-2.0-flash",
  openrouter: "openai/gpt-4o-mini",
};

let _instance: LLMClient | undefined;

export function getLLMClient(): LLMClient {
  if (_instance) return _instance;

  const providerEnv = (process.env.LLM_PROVIDER ?? "openai").toLowerCase() as Provider;
  const validProviders: Provider[] = ["openai", "anthropic", "gemini", "openrouter"];
  const provider: Provider = validProviders.includes(providerEnv) ? providerEnv : "openai";

  const model = process.env.LLM_MODEL ?? DEFAULT_MODELS[provider];

  switch (provider) {
    case "anthropic":
      _instance = new AnthropicAdapter(model);
      break;
    case "gemini":
      _instance = new GeminiAdapter(model);
      break;
    case "openrouter":
      _instance = new OpenRouterAdapter(model);
      break;
    case "openai":
    default:
      _instance = new OpenAIAdapter(model);
      break;
  }

  return _instance;
}
