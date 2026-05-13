#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct McpToolStub {
    pub name: &'static str,
    pub description: &'static str,
}

pub const CROSSHASH_ENTITY_LOOKUP: McpToolStub = McpToolStub {
    name: "crosshash_entity_lookup",
    description: "Look up indexed CrossHash entities by name and repository.",
};

pub const CROSSHASH_GRAPH_TRAVERSE: McpToolStub = McpToolStub {
    name: "crosshash_graph_traverse",
    description:
        "Traverse callers, callees, blast radius, and cycles in an indexed CrossHash graph.",
};

pub fn phase_two_mcp_tool_stubs() -> [McpToolStub; 2] {
    [CROSSHASH_ENTITY_LOOKUP, CROSSHASH_GRAPH_TRAVERSE]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_phase_two_mcp_tool_stub_names() {
        let names = phase_two_mcp_tool_stubs().map(|tool| tool.name);
        assert_eq!(
            names,
            ["crosshash_entity_lookup", "crosshash_graph_traverse"]
        );
    }
}
