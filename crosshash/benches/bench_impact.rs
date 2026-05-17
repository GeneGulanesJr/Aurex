use crosshash_core::{Entity, EntityKind, Language, Visibility};
use crosshash_graph::StaticEdgeExtractor;
use crosshash_hash::EntityHasher;
use crosshash_hash::HashInput;
use crosshash_parser::parse_source;
use std::collections::HashMap;
use std::path::Path;
use std::time::Instant;
use uuid::Uuid;

fn make_entity(name: &str, file: &str, kind: EntityKind, language: Language) -> Entity {
    let sig = format!("fn {}()", name);
    let body = format!("fn {}() {{}}", name);
    let hashes = EntityHasher::compute(&HashInput {
        kind,
        signature: sig.clone(),
        body: body.clone(),
        structural_repr: "function_item".to_string(),
        identity_repr: "function_item _".to_string(),
        parent_structural_hash: None,
        depth: 0,
    });
    Entity {
        id: Uuid::new_v5(&Uuid::NAMESPACE_OID, format!("{file}:{name}").as_bytes()),
        repo_id: Uuid::NAMESPACE_OID,
        file_path: file.to_string(),
        language,
        kind,
        name: name.to_string(),
        qualified_name: name.to_string(),
        signature: sig,
        start_line: 1,
        end_line: 1,
        start_byte: 0,
        end_byte: body.len() as u32,
        signature_hash: hashes.signature_hash,
        content_hash: hashes.content_hash,
        structural_hash: hashes.structural_hash,
        identity_hash: hashes.identity_hash,
        context_hash: hashes.context_hash,
        visibility: Visibility::Public,
        is_exported: true,
        is_async: false,
        is_test: false,
        first_seen_commit: "bench".to_string(),
        last_seen_commit: "bench".to_string(),
        deleted_at_commit: None,
    }
}

fn bench_parsing(iterations: usize) -> std::time::Duration {
    let source = "fn main() { println!(\"hello\"); }\nfn helper(x: i32) -> i32 { x + 1 }\n";
    let mut total = std::time::Duration::ZERO;
    for _ in 0..iterations {
        let start = Instant::now();
        let _ = parse_source(source, Language::Rust).unwrap();
        total += start.elapsed();
    }
    total
}

fn bench_hashing(iterations: usize) -> std::time::Duration {
    let mut total = std::time::Duration::ZERO;
    for i in 0..iterations {
        let input = HashInput {
            kind: EntityKind::Function,
            signature: format!("fn f{i}()"),
            body: format!("fn f{i}() {{}}"),
            structural_repr: "function_item parameters block".to_string(),
            identity_repr: "function_item _ _".to_string(),
            parent_structural_hash: None,
            depth: 0,
        };
        let start = Instant::now();
        let _ = EntityHasher::compute(&input);
        total += start.elapsed();
    }
    total
}

fn bench_edge_extraction(entity_count: usize, iterations: usize) -> std::time::Duration {
    let mut entities = Vec::new();
    let mut sources = HashMap::new();
    for i in 0..entity_count {
        let name = format!("fn_{i}");
        let file = format!("src/mod_{}/lib.rs", i % 10);
        let source = format!(
            "use crate::other::fn_{};\nfn {}() {{ fn_{}() }}",
            i.max(1),
            name,
            i.max(1)
        );
        entities.push(make_entity(
            &name,
            &file,
            EntityKind::Function,
            Language::Rust,
        ));
        sources.insert(file, source);
    }
    let mut total = std::time::Duration::ZERO;
    for _ in 0..iterations {
        let start = Instant::now();
        let _ =
            StaticEdgeExtractor::extract(Uuid::NAMESPACE_OID, Path::new("."), &entities, &sources);
        total += start.elapsed();
    }
    total
}

fn main() {
    let warmup = 100;
    let iterations = 1000;

    println!("CrossHash Benchmark Suite");
    println!("===========================\n");

    println!("Warming up ({warmup} iterations)...");
    let _ = bench_parsing(warmup);
    let _ = bench_hashing(warmup);

    println!("\n--- Parse Benchmark ---");
    let parse_duration = bench_parsing(iterations);
    println!(
        "  {} iterations: {:?} total, {:.2?} avg per parse",
        iterations,
        parse_duration,
        parse_duration / iterations as u32
    );

    println!("\n--- 5-Hash BLAKE3 Benchmark ---");
    let hash_duration = bench_hashing(iterations);
    println!(
        "  {} iterations: {:?} total, {:.2?} avg per 5-hash",
        iterations,
        hash_duration,
        hash_duration / iterations as u32
    );

    println!("\n--- Edge Extraction Benchmark ---");
    for &count in &[10, 100, 500] {
        let iters = if count <= 100 { 100 } else { 10 };
        let edge_duration = bench_edge_extraction(count, iters);
        println!(
            "  {} entities x {} iterations: {:?} total, {:.2?} avg",
            count,
            iters,
            edge_duration,
            edge_duration / iters as u32
        );
    }

    println!("\n--- Target Metrics Check ---");
    let avg_parse_ms = parse_duration.as_millis() as f64 / iterations as f64;
    let files_per_sec = if avg_parse_ms > 0.0 {
        1000.0 / avg_parse_ms
    } else {
        f64::MAX
    };
    println!(
        "  Parse throughput: {:.0} files/sec (target: >100)",
        files_per_sec
    );

    let edge_duration_100 = bench_edge_extraction(100, 50);
    let avg_edge_ms = edge_duration_100.as_millis() as f64 / 50.0;
    println!(
        "  Impact query estimate: {:.1}ms for 100 entities (target: <200ms)",
        avg_edge_ms
    );

    if files_per_sec >= 100.0 {
        println!("\n  ✓ Parse throughput meets target");
    } else {
        println!(
            "\n  ✗ Parse throughput below target ({:.0} < 100 files/sec)",
            files_per_sec
        );
    }

    if avg_edge_ms < 200.0 {
        println!("  ✓ Impact query time within target");
    } else {
        println!(
            "  ✗ Impact query time exceeds target ({:.1}ms > 200ms)",
            avg_edge_ms
        );
    }
}
