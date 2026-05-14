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
            assert!(!tool.description.is_empty(), "tool '{}' has empty description", tool.name);
        }
    }

    #[test]
    fn trim_to_budget_zero_tokens_returns_full_value() {
        let server = McpServer { max_tokens: 0 };
        let value = "hello world";
        assert_eq!(server.trim_to_budget(value), value);
    }

    #[test]
    fn trim_to_budget_within_limit_returns_full_value() {
        let server = McpServer { max_tokens: 100 };
        assert_eq!(server.trim_to_budget("short"), "short");
    }

    #[test]
    fn trim_to_budget_truncates_and_appends_ellipsis() {
        let server = McpServer { max_tokens: 1 };
        let input = "abcdefgh";
        let result = server.trim_to_budget(input);
        assert!(result.ends_with('…'), "should end with ellipsis char");
        assert_eq!(result.chars().count(), 5);
    }

    #[test]
    fn trim_to_budget_exact_boundary_not_truncated() {
        let server = McpServer { max_tokens: 2 };
        let input = "abcd";
        assert_eq!(server.trim_to_budget(input), "abcd");
    }

    #[test]
    fn trim_to_budget_one_over_boundary_truncated() {
        let server = McpServer { max_tokens: 1 };
        let input = "abcde";
        let result = server.trim_to_budget(input);
        assert!(result.ends_with('…'));
    }

    #[test]
    fn mcp_tool_serialization() {
        let tool = McpTool {
            name: "crosshash_test",
            description: "test tool",
        };
        let json = serde_json::to_string(&tool).unwrap();
        assert!(json.contains("\"crosshash_test\""));
        assert!(json.contains("\"test tool\""));
    }

    #[test]
    fn default_server_has_zero_max_tokens() {
        let server = McpServer::default();
        assert_eq!(server.max_tokens, 0);
    }

    #[test]
    fn trim_to_budget_empty_string() {
        let server = McpServer { max_tokens: 1 };
        assert_eq!(server.trim_to_budget(""), "");
    }
}
