// packages/backend/src/clients/pinyx-client.ts

export interface PinyxClientConfig {
  endpoint: string;
}

export interface ChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  content: string;
  finishReason: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface PinyxClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
  ping(): Promise<void>;
}

export function createPinyxClient(config: PinyxClientConfig): PinyxClient {
  const base = config.endpoint.replace(/\/$/, "");

  async function request<T>(path: string, opts?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...opts,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "unknown error");
      throw new Error(`PiNyx ${res.status}: ${path} — ${text}`);
    }
    return res.json();
  }

  return {
    async chat(req) {
      const body = {
        model: req.model,
        messages: req.messages,
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
      };
      const res = await request<{
        id: string;
        choices: Array<{ message: { content: string }; finish_reason: string }>;
        usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
      }>("/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });

      return {
        content: res.choices[0]?.message?.content ?? "",
        finishReason: res.choices[0]?.finish_reason ?? "stop",
        usage: {
          promptTokens: res.usage?.prompt_tokens ?? 0,
          completionTokens: res.usage?.completion_tokens ?? 0,
          totalTokens: res.usage?.total_tokens ?? 0,
        },
      };
    },

    async ping() {
      await request("/v1/models", { method: "GET" });
    },
  };
}
