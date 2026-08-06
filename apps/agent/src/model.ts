import { ChatOllama } from "@langchain/ollama";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";

export interface ModelConfig {
  /** Defaults to $ICAD_AGENT_MODEL_PROVIDER, then "ollama". */
  provider?: string;
  /** Defaults to $ICAD_AGENT_MODEL, then a provider-specific default. */
  model?: string;
  /** Ollama only. Defaults to $OLLAMA_BASE_URL, then @langchain/ollama's own default
   * (http://localhost:11434). */
  baseUrl?: string;
}

const DEFAULT_OLLAMA_MODEL = "qwen3:8b";

/** Provider-agnostic model resolution (docs/00-decision-log.md#d36): reads config/env instead of
 * hardcoding a vendor SDK. Only "ollama" is implemented today — this project's own local
 * verification setup — but the switch is structured so a real cloud provider can be added later
 * without reshaping callers, which all depend on the returned `LanguageModelLike`, never on a
 * concrete class. */
export function resolveChatModel(config: ModelConfig = {}): BaseLanguageModel {
  const provider =
    config.provider ?? process.env.ICAD_AGENT_MODEL_PROVIDER ?? "ollama";

  switch (provider) {
    case "ollama": {
      const model =
        config.model ?? process.env.ICAD_AGENT_MODEL ?? DEFAULT_OLLAMA_MODEL;
      const baseUrl = config.baseUrl ?? process.env.OLLAMA_BASE_URL;
      return new ChatOllama({
        model,
        temperature: 0,
        ...(baseUrl ? { baseUrl } : {}),
      });
    }
    default:
      throw new Error(
        `Unsupported model provider "${provider}" (ICAD_AGENT_MODEL_PROVIDER). Only "ollama" is implemented so far.`,
      );
  }
}
