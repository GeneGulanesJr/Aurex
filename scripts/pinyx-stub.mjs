import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 7331);

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

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
      json(res, 200, {
        id: "chatcmpl-stub",
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "test-model",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: '{"milestones":[{"title":"M1","description":"Setup","units":[],"criteria":[],"testCommands":[]}]}' },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      });
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/config") {
    return json(res, 200, {
      gateway: { port: PORT },
      providers: { stub: { type: "stub" } },
    });
  }

  if (req.method === "GET" && url.pathname === "/api/keys") {
    return json(res, 200, {
      providers: { stub: { status: "active", masked: "sk-***stub***" } },
    });
  }

  json(res, 404, { error: { message: "Not found" } });
});

server.listen(PORT, () => {
  console.log(`[pinyx-stub] Listening on port ${PORT}`);
});
