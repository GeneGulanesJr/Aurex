use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpTool {
    pub name: &'static str,
    pub description: &'static str,
}

#[derive(Debug, Clone, Default)]
pub struct McpServer {
    pub max_tokens: usize,
}

impl McpServer {
    pub fn tools(&self) -> Vec<McpTool> {
        vec![
            McpTool {
                name: "crosshash_index",
                description: "index or re-index a repository",
            },
            McpTool {
                name: "crosshash_list_repos",
                description: "list registered repos with stats",
            },
            McpTool {
                name: "crosshash_impact",
                description: "run zero-AI impact analysis",
            },
            McpTool {
                name: "crosshash_entity_lookup",
                description: "find entity by name across repos",
            },
            McpTool {
                name: "crosshash_entity_context",
                description: "entity callers, callees, and dependencies",
            },
            McpTool {
                name: "crosshash_graph_traverse",
                description: "custom graph traversal",
            },
            McpTool {
                name: "crosshash_discover_edges",
                description: "trigger gated edge discovery",
            },
            McpTool {
                name: "crosshash_diff",
                description: "structural diff between commits",
            },
            McpTool {
                name: "crosshash_feedback",
                description: "accept or reject AI suggestions",
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
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exposes_required_tools() {
        let names = McpServer::default()
            .tools()
            .into_iter()
            .map(|t| t.name)
            .collect::<Vec<_>>();
        assert!(names.contains(&"crosshash_impact"));
        assert!(names.contains(&"crosshash_feedback"));
    }
}
