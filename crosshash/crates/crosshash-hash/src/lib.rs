pub mod hasher;
pub mod incremental;

pub use hasher::{hash_bytes, hash_file_content, ComputedHashes, EntityHasher, HashInput};
pub use incremental::{decide_incremental, FileHashState, IncrementalDecision};
