use anyhow::Result;
use crosshash_core::Repo;
use crosshash_graph::{GraphBuilder, GraphStorage, GraphTraversal};
use crosshash_impact::{ImpactAnalyzer, ImpactClassifier, ChangeKind};
use serde::{Deserialize, Serialize};
use std::io::{BufRead, Read, Write};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: &'static str,
    pub description: &'static str,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

pub struct McpServer {
    storage: Arc<Mutex<GraphStorage>>,
    pub max_tokens: usize,
}

impl std::fmt::Debug for McpServer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("McpServer")
            .field("max_tokens", &self.max_tokens)
            .finish_non_exhaustive()
    }
}

impl Default for McpServer {
    fn default() -> Self {
        Self {
            storage: Arc::new(Mutex::new(
                GraphStorage::open_in_memory().expect("in-memory storage"),
            )),
            max_tokens: 0,
        }
    }
}

impl McpServer {
    pub fn new(storage: GraphStorage) -> Self {
        Self {
            storage: Arc::new(Mutex::new(storage)),
            max_tokens: 0,
        }
    }

    pub fn tools(&self) -> Vec<McpTool> {
        vec![
            McpTool {
                name: "crosshash_index",
                description: "index or re-index a repository",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string", "description": "repository name"}
                    },
                    "required": ["repo"]
                }),
            },
            McpTool {
                name: "crosshash_list_repos",
                description: "list registered repos with stats",
                input_schema: serde_json::json!({"type": "object", "properties": {}}),
            },
            McpTool {
                name: "crosshash_impact",
                description: "run zero-AI impact analysis",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "entity": {"type": "string", "description": "entity name to analyze"},
                        "repo": {"type": "string", "description": "source repo name"}
                    }
                }),
            },
            McpTool {
                name: "crosshash_entity_lookup",
                description: "find entity by name across repos",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "entity name"},
                        "repo": {"type": "string", "description": "limit to repo"}
                    },
                    "required": ["name"]
                }),
            },
            McpTool {
                name: "crosshash_entity_context",
                description: "entity callers, callees, and dependencies",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "repo": {"type": "string"},
                        "depth": {"type": "integer", "default": 2}
                    },
                    "required": ["name", "repo"]
                }),
            },
            McpTool {
                name: "crosshash_graph_traverse",
                description: "custom graph traversal",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "repo": {"type": "string"},
                        "direction": {"type": "string", "enum": ["callers", "callees"]},
                        "depth": {"type": "integer", "default": 2}
                    },
                    "required": ["name", "repo", "direction"]
                }),
            },
            McpTool {
                name: "crosshash_discover_edges",
                description: "trigger gated edge discovery",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string"}
                    }
                }),
            },
            McpTool {
                name: "crosshash_diff",
                description: "structural diff between commits",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "repo": {"type": "string"},
                        "from": {"type": "string"},
                        "to": {"type": "string"}
                    },
                    "required": ["repo"]
                }),
            },
            McpTool {
                name: "crosshash_feedback",
                description: "accept or reject AI suggestions",
                input_schema: serde_json::json!({
                    "type": "object",
                    "properties": {
                        "edge_id": {"type": "string"},
                        "decision": {"type": "string", "enum": ["accept", "reject"]}
                    },
                    "required": ["edge_id", "decision"]
                }),
            },
        ]
    }

    pub fn trim_to_budget(&self, value: &str) -> String {
        let max = self.max_tokens.saturating_mul(4);
        if max == 0 || value.len() <= max {
            value.to_string()
        } else {
            format!("{}…", &value[..max])
        }
    }

    pub fn run(&self) -> Result<()> {
        let stdin = std::io::stdin();
        let mut stdout = std::io::stdout();
        let mut lock = stdin.lock();

        loop {
            let mut header = String::new();
            loop {
                header.clear();
                if lock.read_line(&mut header)? == 0 {
                    return Ok(());
                }
                let trimmed = header.trim();
                if trimmed.is_empty() {
                    break;
                }
                if let Some(len_str) = trimmed.strip_prefix("Content-Length:") {
                    let len: usize = len_str.trim().parse()?;
                    let mut buf = vec![0u8; len];
                    lock.read_exact(&mut buf)?;
                    let request: serde_json::Value = serde_json::from_slice(&buf)?;
                    let response = self.handle_request(request);
                    let response_bytes = serde_json::to_vec(&response)?;
                    write!(
                        stdout,
                        "Content-Length: {}\r\n\r\n",
                        response_bytes.len()
                    )?;
                    stdout.write_all(&response_bytes)?;
                    stdout.flush()?;
                    break;
                }
            }
        }
    }

    fn handle_request(&self, request: serde_json::Value) -> serde_json::Value {
        let id = request.get("id").cloned();
        let method = request
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(serde_json::json!({}));

        if request.get("method").is_some() && request.get("id").is_none() {
            return serde_json::json!({});
        }

        let result = match method {
            "initialize" => self.handle_initialize(params),
            "ping" => Ok(serde_json::json!({})),
            "tools/list" => self.handle_tools_list(),
            "tools/call" => self.handle_tools_call(params),
            _ => {
                return serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": {"code": -32601, "message": format!("method not found: {method}")}
                });
            }
        };

        match result {
            Ok(r) => serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": r
            }),
            Err(e) => serde_json::json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32603, "message": e.to_string()}
            }),
        }
    }

    fn handle_initialize(&self, _params: serde_json::Value) -> Result<serde_json::Value> {
        Ok(serde_json::json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "crosshash",
                "version": env!("CARGO_PKG_VERSION")
            }
        }))
    }

    fn handle_tools_list(&self) -> Result<serde_json::Value> {
        Ok(serde_json::json!({
            "tools": self.tools()
        }))
    }

    fn handle_tools_call(&self, params: serde_json::Value) -> Result<serde_json::Value> {
        let tool_name = params
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let arguments = params
            .get("arguments")
            .cloned()
            .unwrap_or(serde_json::json!({}));

        let text = match tool_name {
            "crosshash_list_repos" => self.tool_list_repos()?,
            "crosshash_entity_lookup" => self.tool_entity_lookup(&arguments)?,
            "crosshash_entity_context" => self.tool_entity_context(&arguments)?,
            "crosshash_graph_traverse" => self.tool_graph_traverse(&arguments)?,
            "crosshash_impact" => self.tool_impact(&arguments)?,
            "crosshash_discover_edges" => self.tool_discover_edges(&arguments)?,
            "crosshash_diff" => self.tool_diff(&arguments)?,
            "crosshash_feedback" => self.tool_feedback(&arguments)?,
            "crosshash_index" => {
                let repo = arguments["repo"].as_str().unwrap_or("");
                format!(
                    "Indexing must be triggered via CLI: crosshash index --repo {repo}. \
                     The MCP server exposes read-only operations; use the CLI or HTTP API for mutations."
                )
            }
            _ => format!("unknown tool: {tool_name}"),
        };

        Ok(serde_json::json!({
            "content": [{"type": "text", "text": text}]
        }))
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, GraphStorage>> {
        self.storage.lock().map_err(|e| anyhow::anyhow!("storage lock: {e}"))
    }

    fn tool_list_repos(&self) -> Result<String> {
        let storage = self.lock()?;
        let repos = storage.list_repos()?;
        if repos.is_empty() {
            return Ok("No repos registered. Use `crosshash repo add` to register.".into());
        }
        let mut lines = Vec::new();
        for repo in &repos {
            let entities = storage.get_entities_by_repo(repo.id).unwrap_or_default();
            let exports = storage.get_public_api_surface(repo.id).unwrap_or_default();
            lines.push(format!(
                "{}\t{}\tentities:{}\texports:{}\tworkspace:{:?}",
                repo.name,
                repo.root_path,
                entities.len(),
                exports.len(),
                repo.workspace_type
            ));
        }
        Ok(lines.join("\n"))
    }

    fn tool_entity_lookup(&self, args: &serde_json::Value) -> Result<String> {
        let name = args["name"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'name' parameter"))?;
        let storage = self.lock()?;
        let repo_id = if let Some(repo_name) = args["repo"].as_str() {
            storage.get_repo_by_name(repo_name)?.map(|r| r.id)
        } else {
            None
        };
        let entities = storage.get_entities_by_name(name, repo_id)?;
        if entities.is_empty() {
            return Ok(format!("No entities found matching '{name}'"));
        }
        let lines: Vec<String> = entities
            .iter()
            .map(|e| {
                format!(
                    "{}\t{}\t{:?}\t{:?}\tline {}-{}",
                    e.qualified_name, e.file_path, e.kind, e.language, e.start_line, e.end_line
                )
            })
            .collect();
        Ok(lines.join("\n"))
    }

    fn tool_entity_context(&self, args: &serde_json::Value) -> Result<String> {
        let name = args["name"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'name' parameter"))?;
        let repo_name = args["repo"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'repo' parameter"))?;
        let depth = args["depth"].as_u64().unwrap_or(2) as usize;
        let storage = self.lock()?;
        let repo = storage
            .get_repo_by_name(repo_name)?
            .ok_or_else(|| anyhow::anyhow!("repo not found: {repo_name}"))?;
        let entity = storage
            .get_entities_by_name(name, Some(repo.id))?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("entity not found: {name}"))?;
        let graph = GraphBuilder::from_storage(&storage, repo.id)?;
        let traversal = GraphTraversal::new(&graph);
        let callers = traversal.callers(entity.id, depth);
        let callees = traversal.callees(entity.id, depth);
        let mut result = format!("Entity: {} ({:?})\n", entity.qualified_name, entity.kind);
        result.push_str(&format!(
            "Callers ({}):\n",
            callers.len()
        ));
        for hit in &callers {
            result.push_str(&format!(
                "  {} (depth={})\n",
                hit.entity.qualified_name, hit.distance
            ));
        }
        result.push_str(&format!(
            "Callees ({}):\n",
            callees.len()
        ));
        for hit in &callees {
            result.push_str(&format!(
                "  {} (depth={})\n",
                hit.entity.qualified_name, hit.distance
            ));
        }
        Ok(result)
    }

    fn tool_graph_traverse(&self, args: &serde_json::Value) -> Result<String> {
        let name = args["name"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'name'"))?;
        let repo_name = args["repo"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'repo'"))?;
        let direction = args["direction"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'direction'"))?;
        let depth = args["depth"].as_u64().unwrap_or(2) as usize;
        let storage = self.lock()?;
        let repo = storage
            .get_repo_by_name(repo_name)?
            .ok_or_else(|| anyhow::anyhow!("repo not found: {repo_name}"))?;
        let entity = storage
            .get_entities_by_name(name, Some(repo.id))?
            .into_iter()
            .next()
            .ok_or_else(|| anyhow::anyhow!("entity not found: {name}"))?;
        let graph = GraphBuilder::from_storage(&storage, repo.id)?;
        let traversal = GraphTraversal::new(&graph);
        let hits = match direction {
            "callers" => traversal.callers(entity.id, depth),
            "callees" => traversal.callees(entity.id, depth),
            _ => return Err(anyhow::anyhow!("direction must be 'callers' or 'callees'")),
        };
        if hits.is_empty() {
            return Ok(format!("No {direction} for {}", entity.qualified_name));
        }
        let lines: Vec<String> = hits
            .iter()
            .map(|h| format!("{}\tdepth={}", h.entity.qualified_name, h.distance))
            .collect();
        Ok(lines.join("\n"))
    }

    fn tool_impact(&self, args: &serde_json::Value) -> Result<String> {
        let storage = self.lock()?;
        let entities = storage.get_entities_all()?;
        let edges = storage.get_edges_all()?;
        let changed: Vec<Uuid> = if let Some(entity_name) = args["entity"].as_str() {
            storage
                .get_entities_by_name(entity_name, None)?
                .iter()
                .map(|e| e.id)
                .collect()
        } else {
            entities.iter().take(1).map(|e| e.id).collect()
        };
        if changed.is_empty() {
            return Ok("No entities found to analyze".into());
        }
        let affected = ImpactAnalyzer::default().analyze(&changed, &entities, &edges);
        if affected.is_empty() {
            return Ok("No affected entities found".into());
        }
        let mut lines = Vec::new();
        for a in &affected {
            let classification = ImpactClassifier::classify(ChangeKind::Modified, a);
            lines.push(format!(
                "{:?}\t{}\t distance={}\tconfidence={:.2}\t{}",
                classification.risk_level,
                classification.entity_id,
                a.distance,
                a.min_confidence,
                classification.classification
            ));
        }
        Ok(lines.join("\n"))
    }

    fn tool_discover_edges(&self, args: &serde_json::Value) -> Result<String> {
        let storage = self.lock()?;
        let repos = storage.list_repos()?;
        let filtered: Vec<&Repo> = if let Some(name) = args["repo"].as_str() {
            repos.iter().filter(|r| r.name == name).collect()
        } else {
            repos.iter().collect()
        };
        let mut lines = Vec::new();
        for repo in &filtered {
            let exports = storage.get_public_api_surface(repo.id).unwrap_or_default();
            let edges = storage.get_edges_by_repo(repo.id).unwrap_or_default();
            lines.push(format!(
                "{}\texports:{}\tstatic_edges:{}",
                repo.name,
                exports.len(),
                edges.len()
            ));
        }
        if lines.is_empty() {
            return Ok("No repos found".into());
        }
        Ok(lines.join("\n"))
    }

    fn tool_diff(&self, args: &serde_json::Value) -> Result<String> {
        let repo_name = args["repo"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'repo'"))?;
        let storage = self.lock()?;
        let repo = storage
            .get_repo_by_name(repo_name)?
            .ok_or_else(|| anyhow::anyhow!("repo not found: {repo_name}"))?;
        let entities = storage.get_entities_by_repo(repo.id)?;
        if entities.is_empty() {
            return Ok(format!("No entities found in {repo_name}"));
        }
        let from = args["from"].as_str().unwrap_or("");
        let to = args["to"].as_str().unwrap_or("");
        if from.is_empty() || to.is_empty() {
            let summary: Vec<String> = entities
                .iter()
                .take(20)
                .map(|e| format!("{}\t{:?}\t{}", e.name, e.kind, e.last_seen_commit))
                .collect();
            return Ok(format!("Entities in {} (showing up to 20):\n{}", repo_name, summary.join("\n")));
        }
        let old_versions: Vec<_> = entities
            .iter()
            .filter(|e| e.last_seen_commit == from)
            .map(|e| crosshash_core::EntityVersion {
                entity_id: e.id,
                commit_hash: e.last_seen_commit.clone(),
                name: e.name.clone(),
                qualified_name: e.qualified_name.clone(),
                signature: e.signature.clone(),
                signature_hash: e.signature_hash,
                content_hash: e.content_hash,
                structural_hash: e.structural_hash,
                identity_hash: e.identity_hash,
                context_hash: e.context_hash,
                snapshot_at: chrono::Utc::now(),
            })
            .collect();
        let new_versions: Vec<_> = entities
            .iter()
            .filter(|e| e.last_seen_commit == to)
            .map(|e| crosshash_core::EntityVersion {
                entity_id: e.id,
                commit_hash: e.last_seen_commit.clone(),
                name: e.name.clone(),
                qualified_name: e.qualified_name.clone(),
                signature: e.signature.clone(),
                signature_hash: e.signature_hash,
                content_hash: e.content_hash,
                structural_hash: e.structural_hash,
                identity_hash: e.identity_hash,
                context_hash: e.context_hash,
                snapshot_at: chrono::Utc::now(),
            })
            .collect();
        let diffs = crosshash_impact::diff_entities(&old_versions, &new_versions);
        if diffs.is_empty() {
            return Ok("No differences found".into());
        }
        let lines: Vec<String> = diffs
            .iter()
            .map(|d| format!("{:?}\t{}\t{}", d.change_kind, d.entity_id, d.diff_summary))
            .collect();
        Ok(lines.join("\n"))
    }

    fn tool_feedback(&self, args: &serde_json::Value) -> Result<String> {
        let edge_id_str = args["edge_id"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'edge_id'"))?;
        let decision = args["decision"]
            .as_str()
            .ok_or_else(|| anyhow::anyhow!("missing 'decision'"))?;
        let id = Uuid::parse_str(edge_id_str)
            .map_err(|_| anyhow::anyhow!("invalid UUID: {edge_id_str}"))?;
        let storage = self.lock()?;
        let suggestion = storage
            .get_suggestion_by_id(&id)?
            .ok_or_else(|| anyhow::anyhow!("suggestion not found: {edge_id_str}"))?;
        let status = match decision {
            "accept" => "accepted",
            "reject" => "rejected",
            _ => return Err(anyhow::anyhow!("decision must be 'accept' or 'reject'")),
        };
        storage.update_suggestion_status(&id, status)?;
        let fb_id = Uuid::now_v7();
        storage.insert_feedback(&fb_id, &id, decision, None)?;
        if decision == "accept" {
            if let (Some(exporter), Some(consumer)) = (
                suggestion["exporter_entity_id"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok()),
                suggestion["consumer_entity_id"]
                    .as_str()
                    .and_then(|s| Uuid::parse_str(s).ok()),
            ) {
                let edge = crosshash_core::Edge {
                    id: Uuid::now_v7(),
                    source_entity_id: consumer,
                    target_entity_id: exporter,
                    kind: crosshash_core::EdgeKind::PackageDep,
                    confidence: suggestion["confidence"].as_f64().unwrap_or(0.5),
                    source: crosshash_core::EdgeSource::AiInferred,
                    metadata: Some(serde_json::json!({
                        "edge_type": suggestion["edge_type"],
                        "reasoning": suggestion["reasoning"],
                    })),
                    created_at: chrono::Utc::now(),
                    validated_at: Some(chrono::Utc::now()),
                };
                storage.insert_edge(&edge)?;
            }
        }
        Ok(format!("{status} suggestion {edge_id_str}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tool_names() -> Vec<&'static str> {
        McpServer::default()
            .tools()
            .into_iter()
            .map(|t| t.name)
            .collect()
    }

    #[test]
    fn exposes_all_nine_tools() {
        let names = tool_names();
        assert_eq!(names.len(), 9);
    }

    #[test]
    fn all_required_tools_present() {
        let names = tool_names();
        for expected in [
            "crosshash_index",
            "crosshash_list_repos",
            "crosshash_impact",
            "crosshash_entity_lookup",
            "crosshash_entity_context",
            "crosshash_graph_traverse",
            "crosshash_discover_edges",
            "crosshash_diff",
            "crosshash_feedback",
        ] {
            assert!(names.contains(&expected), "missing tool: {expected}");
        }
    }

    #[test]
    fn all_tool_names_prefixed() {
        for tool in McpServer::default().tools() {
            assert!(
                tool.name.starts_with("crosshash_"),
                "tool '{}' missing crosshash_ prefix",
                tool.name
            );
        }
    }

    #[test]
    fn all_tools_have_non_empty_descriptions() {
        for tool in McpServer::default().tools() {
            assert!(
                !tool.description.is_empty(),
                "tool '{}' has empty description",
                tool.name
            );
        }
    }

    #[test]
    fn all_tools_have_input_schemas() {
        for tool in McpServer::default().tools() {
            assert!(
                tool.input_schema["type"] == "object",
                "tool '{}' missing input schema",
                tool.name
            );
        }
    }

    #[test]
    fn trim_to_budget_zero_tokens_returns_full_value() {
        let server = McpServer {
            max_tokens: 0,
            ..Default::default()
        };
        let value = "hello world";
        assert_eq!(server.trim_to_budget(value), value);
    }

    #[test]
    fn trim_to_budget_within_limit_returns_full_value() {
        let server = McpServer {
            max_tokens: 100,
            ..Default::default()
        };
        assert_eq!(server.trim_to_budget("short"), "short");
    }

    #[test]
    fn trim_to_budget_truncates_and_appends_ellipsis() {
        let server = McpServer {
            max_tokens: 1,
            ..Default::default()
        };
        let input = "abcdefgh";
        let result = server.trim_to_budget(input);
        assert!(result.ends_with('…'), "should end with ellipsis char");
        assert_eq!(result.chars().count(), 5);
    }

    #[test]
    fn trim_to_budget_exact_boundary_not_truncated() {
        let server = McpServer {
            max_tokens: 2,
            ..Default::default()
        };
        let input = "abcd";
        assert_eq!(server.trim_to_budget(input), "abcd");
    }

    #[test]
    fn mcp_tool_serialization() {
        let tool = McpTool {
            name: "crosshash_test",
            description: "test tool",
            input_schema: serde_json::json!({"type": "object"}),
        };
        let json = serde_json::to_string(&tool).unwrap();
        assert!(json.contains("\"crosshash_test\""));
        assert!(json.contains("\"test tool\""));
        assert!(json.contains("\"inputSchema\""));
    }

    #[test]
    fn default_server_has_zero_max_tokens() {
        let server = McpServer::default();
        assert_eq!(server.max_tokens, 0);
    }

    #[test]
    fn handle_initialize_returns_capabilities() {
        let server = McpServer::default();
        let result = server.handle_initialize(serde_json::json!({})).unwrap();
        assert_eq!(result["protocolVersion"], "2024-11-05");
        assert!(result["capabilities"]["tools"].is_object());
        assert_eq!(result["serverInfo"]["name"], "crosshash");
    }

    #[test]
    fn handle_tools_list_returns_tools() {
        let server = McpServer::default();
        let result = server.handle_tools_list().unwrap();
        let tools = result["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 9);
    }

    #[test]
    fn handle_request_initialize() {
        let server = McpServer::default();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {}
        });
        let response = server.handle_request(request);
        assert_eq!(response["jsonrpc"], "2.0");
        assert_eq!(response["id"], 1);
        assert!(response["result"]["capabilities"].is_object());
    }

    #[test]
    fn handle_request_tools_list() {
        let server = McpServer::default();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        });
        let response = server.handle_request(request);
        let tools = response["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 9);
    }

    #[test]
    fn handle_request_unknown_method_returns_error() {
        let server = McpServer::default();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 99,
            "method": "nonexistent"
        });
        let response = server.handle_request(request);
        assert_eq!(response["error"]["code"], -32601);
    }

    #[test]
    fn handle_request_notification_returns_empty() {
        let server = McpServer::default();
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        let response = server.handle_request(request);
        assert!(response.is_object());
        assert!(response.as_object().unwrap().is_empty());
    }

    #[test]
    fn tool_list_repos_empty() {
        let server = McpServer::default();
        let result = server.tool_list_repos().unwrap();
        assert!(result.contains("No repos"));
    }

    #[test]
    fn tool_entity_lookup_not_found() {
        let server = McpServer::default();
        let result = server
            .tool_entity_lookup(&serde_json::json!({"name": "nonexistent"}))
            .unwrap();
        assert!(result.contains("No entities found"));
    }

    #[test]
    fn tool_impact_no_entities() {
        let server = McpServer::default();
        let result = server
            .tool_impact(&serde_json::json!({"entity": "nonexistent"}))
            .unwrap();
        assert!(result.contains("No entities found"));
    }

    #[test]
    fn tool_discover_edges_empty() {
        let server = McpServer::default();
        let result = server
            .tool_discover_edges(&serde_json::json!({}))
            .unwrap();
        assert!(result.contains("No repos"));
    }
}
