function jsonError(res, status, code, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message } }));
}

function jsonOk(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function jsonCreated(res, body) {
  res.writeHead(201, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

module.exports = { jsonError, jsonOk, jsonCreated };
