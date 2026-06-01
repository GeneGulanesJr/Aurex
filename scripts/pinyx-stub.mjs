import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 7331);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

const STUB_RESPONSE = '{"milestones":[{"title":"M1","description":"Setup","units":[],"criteria":[],"testCommands":[]}]}';

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok" });
  }

  if (req.method === "GET" && url.pathname === "/v1/models") {
    return json(res, 200, {
      object: "list",
      data: [
        { id: "test-model", object: "model", owned_by: "stub", created: 0 },
      ],
    });
  }

  if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}

      // Streaming response
      if (parsed.stream) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const id = "chatcmpl-stub";
        const created = Math.floor(Date.now() / 1000);

        // Send content delta
        res.write(`data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: parsed.model || "test-model",
          choices: [{
            index: 0,
            delta: { role: "assistant", content: STUB_RESPONSE },
            finish_reason: null,
          }],
        })}\n\n`);

        // Send finish chunk
        res.write(`data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: parsed.model || "test-model",
          choices: [{
            index: 0,
            delta: {},
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        })}\n\n`);

        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      // Non-streaming response
      json(res, 200, {
        id: "chatcmpl-stub",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: parsed.model || "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: STUB_RESPONSE },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
    });
    return;
  }

  if (req.method === "PUT" && url.pathname === "/api/config") {
    // Accept config sync — read and discard body
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      json(res, 200, { ok: true });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    return json(res, 200, {
      gateway: { host: "0.0.0.0", port: PORT },
      providers: {},
    });
  }

  if (req.method === "GET" && url.pathname === "/api/keys") {
    return json(res, 200, {
      providers: {},
    });
  }

  json(res, 404, { error: { message: "Not found" } });
});

server.listen(PORT, () => {
  console.log(`[pinyx-stub] Listening on port ${PORT}`);
});
