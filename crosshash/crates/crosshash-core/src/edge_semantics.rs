//! Edge direction conventions for CrossHash.
//!
//! CrossHash stores dependency edges as:
//!
//! ```text
//! source -> target = source depends on target
//! ```
//!
//! Examples:
//! - Calls: `caller -> callee`
//! - Imports: `importer -> imported`
//! - Extends: `child -> parent`
//! - Contains: `parent -> child` for structural containment, not dependency impact
//!
//! Impact traversal follows reverse dependency edges: when `target` changes, walk incoming
//! edges to find source entities that depend on it.

use crate::EdgeKind;

pub fn is_dependency_edge(kind: EdgeKind) -> bool {
    !matches!(kind, EdgeKind::Contains)
}
