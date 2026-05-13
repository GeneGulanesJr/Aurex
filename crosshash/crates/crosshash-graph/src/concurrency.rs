//! Concurrency boundaries for CrossHash.
//!
//! - Use Rayon for CPU-bound work: Tree-sitter parsing, hash computation, and graph traversal.
//! - Use Tokio for I/O-bound work: HTTP/MCP, filesystem watching, and future LLM calls.
//! - Bridge async callers into CPU work with `tokio::task::spawn_blocking`, then use Rayon inside.

pub fn rayon_pool_size() -> usize {
    num_cpus::get().max(1)
}

pub async fn spawn_cpu_bound<F, R>(work: F) -> Result<R, tokio::task::JoinError>
where
    F: FnOnce() -> R + Send + 'static,
    R: Send + 'static,
{
    tokio::task::spawn_blocking(move || rayon::scope_fifo(|_| work())).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn spawn_cpu_bound_returns_result_from_blocking_work() {
        let result = spawn_cpu_bound(|| (0..=10).sum::<u32>()).await.unwrap();
        assert_eq!(result, 55);
    }

    #[test]
    fn rayon_pool_size_is_non_zero() {
        assert!(rayon_pool_size() >= 1);
    }
}
