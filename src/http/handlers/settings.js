// src/http/handlers/settings.js — KV store for integration tokens and config

function getSetting(sqlJson) {
  return async (req, res, { params }) => {
    const rows = sqlJson('SELECT value FROM settings WHERE key = ?', [params.key]);
    if (!rows.length) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'not_found' }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: params.key, value: JSON.parse(rows[0].value) }));
  };
}

function setSetting(sqlRun) {
  return async (req, res, { params, body }) => {
    if (!body || body.value === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'value is required' }));
    }
    sqlRun(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      [params.key, JSON.stringify(body.value)],
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ key: params.key, value: body.value }));
  };
}

function deleteSetting(sqlRun) {
  return async (req, res, { params }) => {
    sqlRun('DELETE FROM settings WHERE key = ?', [params.key]);
    res.writeHead(204);
    res.end();
  };
}

module.exports = { getSetting, setSetting, deleteSetting };
