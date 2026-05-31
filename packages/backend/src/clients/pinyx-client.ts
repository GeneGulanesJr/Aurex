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
  chatStream(request: ChatRequest, onChunk: (text: string) => void): Promise<ChatResponse>;
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
    return res.json() as Promise<T>;
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

    async chatStream(req, onChunk) {
      const body = {
        model: req.model,
        messages: req.messages,
        stream: true,
        ...(req.temperature !== undefined && { temperature: req.temperature }),
        ...(req.max_tokens !== undefined && { max_tokens: req.max_tokens }),
      };
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "unknown error");
        throw new Error(`PiNyx ${res.status}: /v1/chat/completions — ${text}`);
      }
      if (!res.body) {
        // No streaming support — fall back to full response
        const json = await res.json() as { id: string; choices: Array<{ message: { content: string }; finish_reason: string }>; usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } };
        onChunk(json.choices[0]?.message?.content ?? "");
        return {
          content: json.choices[0]?.message?.content ?? "",
          finishReason: json.choices[0]?.finish_reason ?? "stop",
          usage: { promptTokens: json.usage?.prompt_tokens ?? 0, completionTokens: json.usage?.completion_tokens ?? 0, totalTokens: json.usage?.total_tokens ?? 0 },
        };
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let content = "";
      let finishReason = "stop";
      let usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;
          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;
          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string }>;
              usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
            };
            const delta = chunk.choices?.[0]?.delta?.content ?? "";
            if (delta) {
              content += delta;
              onChunk(delta);
            }
            if (chunk.choices?.[0]?.finish_reason) {
              finishReason = chunk.choices[0].finish_reason;
            }
            if (chunk.usage) {
              usage = { promptTokens: chunk.usage.prompt_tokens, completionTokens: chunk.usage.completion_tokens, totalTokens: chunk.usage.total_tokens };
            }
          } catch { /* skip malformed chunks */ }
        }
      }
      return { content, finishReason, usage };
    },

    async ping() {
      await request("/v1/models", { method: "GET" });
    },
  };
}
