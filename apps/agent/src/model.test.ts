import { afterEach, describe, expect, it } from "vitest";
import { ChatOllama } from "@langchain/ollama";
import { resolveChatModel } from "./model.js";

// ChatOllama's constructor is lazy — it doesn't contact a real Ollama server until a call is
// actually made — so this is safe to test without one running. Verifies resolveChatModel's own
// config/env resolution logic (M30.2's `think` option), not the model's real behavior.

const ENV_KEYS = [
  "ICAD_AGENT_MODEL_PROVIDER",
  "ICAD_AGENT_MODEL",
  "OLLAMA_BASE_URL",
  "ICAD_AGENT_MODEL_THINK",
] as const;

describe("resolveChatModel", () => {
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("defaults to ollama with think left unset (the model's own default)", () => {
    const model = resolveChatModel() as ChatOllama;
    expect(model).toBeInstanceOf(ChatOllama);
    expect(model.model).toBe("qwen3:8b");
    expect(model.think).toBeUndefined();
  });

  it("config.think overrides everything, including a set env var", () => {
    process.env.ICAD_AGENT_MODEL_THINK = "true";
    const model = resolveChatModel({ think: false }) as ChatOllama;
    expect(model.think).toBe(false);
  });

  it("reads think from $ICAD_AGENT_MODEL_THINK when config doesn't set it", () => {
    process.env.ICAD_AGENT_MODEL_THINK = "false";
    const model = resolveChatModel() as ChatOllama;
    expect(model.think).toBe(false);
  });

  it("rejects an invalid $ICAD_AGENT_MODEL_THINK value", () => {
    process.env.ICAD_AGENT_MODEL_THINK = "nope";
    expect(() => resolveChatModel()).toThrow(/ICAD_AGENT_MODEL_THINK/);
  });

  it("rejects an unsupported provider", () => {
    expect(() => resolveChatModel({ provider: "openai" })).toThrow(
      /Unsupported model provider/,
    );
  });
});
