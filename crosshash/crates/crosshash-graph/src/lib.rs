pub mod builder;
pub mod concurrency;
pub mod edge_extractor;
pub mod mcp_stubs;
pub mod staleness;
pub mod storage;
pub mod traversal;

pub use builder::{GraphBuilder, GraphMetrics};
pub use concurrency::{rayon_pool_size, spawn_cpu_bound};
pub use edge_extractor::StaticEdgeExtractor;
pub use mcp_stubs::{phase_two_mcp_tool_stubs, McpToolStub};
pub use staleness::{validate_edges_for_repo, EdgeValidationReport};
pub use storage::GraphStorage;
pub use traversal::{DependencyGraph, EdgeStep, GraphTraversal, TraversalHit};
