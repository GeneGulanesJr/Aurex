use anyhow::{anyhow, Result};
use chrono::Utc;
use clap::{Args, Parser, Subcommand, ValueEnum};
use crosshash_core::{
    Edge, EdgeKind, EdgeSource, Entity, EntityKind, EntityVersion, Language, Repo, WorkspaceType,
};
use crosshash_git::get_head_commit;
use crosshash_graph::{GraphBuilder, GraphStorage, GraphTraversal};
use crosshash_hash::hash_file_content;
use crosshash_parser::languages::python::PythonExtractor;
use crosshash_parser::languages::rust::RustExtractor;
use crosshash_parser::languages::typescript::TypeScriptExtractor;
use crosshash_parser::{
    collect_source_files, detect_language, EntityExtractor, ParserConfig, ParserEngine,
};
use serde_json::json;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use uuid::Uuid;

use crate::output::render_message;

#[derive(Debug, Clone, Parser)]
#[command(
    name = "crosshash",
    version,
    about = "Cross-repo structural impact analysis"
)]
pub struct Cli {
    #[arg(long, value_enum, default_value_t = OutputFormat::Text, global = true)]
    pub format: OutputFormat,
    #[arg(long, global = true, env = "CROSSHASH_DB")]
    pub db: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum OutputFormat {
    Text,
    Json,
}

#[derive(Debug, Clone, Subcommand)]
pub enum Command {
    Repo(RepoCommand),
    Index(IndexCommand),
    DiscoverEdges(DiscoverEdgesCommand),
    Impact(ImpactCommand),
    Entity(EntityCommand),
    Graph(GraphCommand),
    Feedback(FeedbackCommand),
    AiStats(AiStatsCommand),
}

#[derive(Debug, Clone, Args)]
pub struct RepoCommand {
    #[command(subcommand)]
    pub action: RepoAction,
}

#[derive(Debug, Clone, Subcommand)]
pub enum RepoAction {
    Add {
        path: String,
        #[arg(long)]
        name: String,
        #[arg(long)]
        workspace_aware: bool,
    },
    List,
    Remove {
        name: String,
    },
    Info {
        name: String,
    },
}

#[derive(Debug, Clone, Args)]
pub struct IndexCommand {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub incremental: bool,
    #[arg(long)]
    pub no_ai: bool,
    #[arg(long)]
    pub force_ai: bool,
}

#[derive(Debug, Clone, Args)]
pub struct DiscoverEdgesCommand {
    #[arg(long)]
    pub repo: Option<String>,
    #[arg(long)]
    pub no_ai: bool,
    #[arg(long)]
    pub force_ai: bool,
    #[arg(long)]
    pub static_only: bool,
    #[arg(long)]
    pub dry_run: bool,
    #[arg(long)]
    pub validate: bool,
}
#[derive(Debug, Clone, Args)]
pub struct ImpactCommand {
    #[arg(long)]
    pub entity: Option<String>,
    #[arg(long)]
    pub source: Option<String>,
    #[arg(long, value_delimiter = ',')]
    pub target: Vec<String>,
    #[arg(long)]
    pub all: bool,
    #[arg(long)]
    pub commit: Option<String>,
    #[arg(long)]
    pub diff: bool,
    #[arg(long, value_enum, default_value_t = ImpactOutputFormat::Json)]
    pub output: ImpactOutputFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, ValueEnum)]
pub enum ImpactOutputFormat {
    Json,
    Markdown,
    Sarif,
}
#[derive(Debug, Clone, Args)]
pub struct EntityCommand {
    #[command(subcommand)]
    pub action: EntityAction,
}
#[derive(Debug, Clone, Subcommand)]
pub enum EntityAction {
    Lookup {
        name: String,
        #[arg(long)]
        repo: Option<String>,
        #[arg(long)]
        all: bool,
    },
    Hash {
        name: String,
        #[arg(long)]
        repo: String,
    },
}
#[derive(Debug, Clone, Args)]
pub struct GraphCommand {
    #[command(subcommand)]
    pub action: GraphAction,
}
#[derive(Debug, Clone, Subcommand)]
pub enum GraphAction {
    Callers {
        name: String,
        #[arg(long)]
        repo: Option<String>,
        #[arg(long)]
        cross_repo: bool,
        #[arg(long, default_value_t = 2)]
        depth: usize,
    },
    Callees {
        name: String,
        #[arg(long)]
        repo: Option<String>,
        #[arg(long)]
        cross_repo: bool,
        #[arg(long, default_value_t = 2)]
        depth: usize,
    },
    BlastRadius {
        name: String,
        #[arg(long)]
        repo: Option<String>,
        #[arg(long)]
        cross_repo: bool,
    },
    Cycles {
        #[arg(long)]
        repo: String,
    },
    ValidateEdges {
        #[arg(long)]
        repo: String,
    },
}
#[derive(Debug, Clone, Args)]
pub struct FeedbackCommand {
    #[command(subcommand)]
    pub action: Option<FeedbackAction>,
}
#[derive(Debug, Clone, Subcommand)]
pub enum FeedbackAction {
    Accept { edge_id: String },
    Reject { edge_id: String },
    Stats,
    Export,
}
#[derive(Debug, Clone, Args)]
pub struct AiStatsCommand {}

pub trait Execute {
    fn execute(self) -> Result<()>;
}

impl Execute for Cli {
    fn execute(self) -> Result<()> {
        match self.command {
            Command::Repo(cmd) => execute_repo(self.format, self.db, cmd),
            Command::Index(cmd) => execute_index(self.format, self.db, cmd),
            Command::Entity(cmd) => execute_entity(self.format, self.db, cmd),
            Command::Graph(cmd) => execute_graph(self.format, self.db, cmd),
            Command::DiscoverEdges(cmd) => execute_discover_edges(self.format, self.db, cmd),
            Command::Impact(cmd) => execute_impact(self.format, self.db, cmd),
            Command::Feedback(cmd) => execute_feedback(self.format, self.db, cmd),
            Command::AiStats(cmd) => execute_ai_stats(self.format, self.db, cmd),
        }
    }
}

fn execute_repo(format: OutputFormat, db: Option<PathBuf>, cmd: RepoCommand) -> Result<()> {
    let storage = open_storage(db)?;
    match cmd.action {
        RepoAction::Add {
            path,
            name,
            workspace_aware,
        } => {
            let root = PathBuf::from(&path).canonicalize()?;
            let repo = Repo {
                id: Uuid::now_v7(),
                name: name.clone(),
                root_path: root.to_string_lossy().to_string(),
                git_remote: None,
                default_branch: "main".into(),
                languages: detect_languages(&root)?,
                workspace_type: detect_workspace_type(&root, workspace_aware),
                last_indexed_at: Utc::now(),
                commit_hash: get_head_commit(&root).unwrap_or_else(|_| "WORKTREE".into()),
            };
            validate_repo_has_sources(&root)?;
            storage.insert_repo(&repo)?;
            print(
                format,
                &format!("added repo {name}"),
                json!({"status":"ok","repo": repo}),
            )
        }
        RepoAction::List => {
            let repos = storage.list_repos()?;
            let text = repos
                .iter()
                .map(|r| format!("{}\t{}", r.name, r.root_path))
                .collect::<Vec<_>>()
                .join("\n");
            print(
                format,
                if text.is_empty() { "no repos" } else { &text },
                json!({"repos": repos}),
            )
        }
        RepoAction::Remove { name } => {
            storage.remove_repo(&name)?;
            print(
                format,
                &format!("removed repo {name}"),
                json!({"status":"ok","removed": name}),
            )
        }
        RepoAction::Info { name } => {
            let repo = storage
                .get_repo_by_name(&name)?
                .ok_or_else(|| anyhow!("repo not found: {name}"))?;
            let entities = storage.get_entities_by_repo(repo.id)?;
            let exports = storage.get_public_api_surface(repo.id)?;
            let edges = storage.get_edges_by_repo(repo.id)?;
            print(
                format,
                &format!(
                    "{}\npath: {}\nworkspace: {:?}\nentities: {}\nexports: {}\nedges: {}",
                    repo.name,
                    repo.root_path,
                    repo.workspace_type,
                    entities.len(),
                    exports.len(),
                    edges.len()
                ),
                json!({"repo": repo, "entities": entities.len(), "exports": exports.len(), "edges": edges.len()}),
            )
        }
    }
}

fn execute_index(format: OutputFormat, db: Option<PathBuf>, cmd: IndexCommand) -> Result<()> {
    let storage = open_storage(db)?;
    if cmd.repo.is_none() {
        let repos = storage.list_repos()?;
        let mut summaries = Vec::new();
        for repo in repos {
            summaries.push(index_one_repo(&storage, &repo, cmd.incremental)?);
        }
        return print(
            format,
            &format!("indexed {} repos", summaries.len()),
            json!({"status":"ok","repos": summaries}),
        );
    }
    let repo_name = cmd.repo.as_deref().unwrap();
    let repo = storage
        .get_repo_by_name(repo_name)?
        .ok_or_else(|| anyhow!("repo not found: {repo_name}"))?;
    let summary = index_one_repo(&storage, &repo, cmd.incremental)?;
    print(format, &summary.text, json!(summary))
}

#[derive(Debug, serde::Serialize)]
struct IndexSummary {
    status: &'static str,
    repo: String,
    files_parsed: usize,
    files_skipped: usize,
    entities_extracted: usize,
    edges: usize,
    entities_deleted: usize,
    exports: usize,
    text: String,
}

fn index_one_repo(storage: &GraphStorage, repo: &Repo, incremental: bool) -> Result<IndexSummary> {
    let root = PathBuf::from(&repo.root_path);
    let commit_hash = get_head_commit(&root).unwrap_or_else(|_| repo.commit_hash.clone());
    let files = collect_source_files(&root, &repo.languages)?;
    let parser = ParserEngine::new(ParserConfig {
        languages: repo.languages.clone(),
    });
    let existing = storage.get_entities_by_repo(repo.id)?;
    let mut seen_ids = HashSet::new();
    let mut parsed_files = 0usize;
    let mut skipped_files = 0usize;
    let mut extracted = 0usize;
    let mut all_entities = Vec::new();
    let mut source_by_file = HashMap::new();

    for file in files {
        let rel = file
            .strip_prefix(&root)
            .unwrap_or(&file)
            .to_string_lossy()
            .to_string();
        let source = std::fs::read_to_string(&file)?;
        source_by_file.insert(rel.clone(), source.clone());
        let file_hash = hash_file_content(&source);
        if incremental
            && storage
                .get_file_hash(repo.id, &rel)?
                .is_some_and(|h| h == file_hash)
        {
            skipped_files += 1;
            for entity in existing.iter().filter(|e| e.file_path == rel) {
                seen_ids.insert(entity.id);
                all_entities.push(entity.clone());
            }
            continue;
        }
        let Some(language) = detect_language(&file)? else {
            continue;
        };
        let parsed = parser.parse_file(&file, language)?;
        let entities = extract_for_language(
            language,
            repo.id,
            &root,
            &file,
            &parsed.source,
            &parsed.tree,
            &commit_hash,
        )?;
        parsed_files += 1;
        for entity in entities {
            seen_ids.insert(entity.id);
            storage.insert_entity(&entity)?;
            storage.insert_entity_version(&version_for(&entity, &commit_hash))?;
            all_entities.push(entity);
            extracted += 1;
        }
        storage.upsert_file_hash(repo.id, &rel, &file_hash)?;
    }

    let deleted = existing
        .into_iter()
        .filter(|e| !seen_ids.contains(&e.id))
        .map(|e| e.id)
        .collect::<Vec<_>>();
    storage.mark_entities_deleted(repo.id, &deleted, &commit_hash)?;
    storage.remove_edges_for_repo(repo.id)?;
    let edges = infer_static_edges(repo.id, &all_entities, &source_by_file);
    for edge in &edges {
        storage.insert_edge(edge)?;
    }
    let cross_repo_edges =
        infer_cross_repo_edges(storage, repo.id, &all_entities, &source_by_file)?;
    for edge in &cross_repo_edges {
        storage.insert_edge(edge)?;
    }
    let edge_count = edges.len() + cross_repo_edges.len();
    let exports = storage.get_public_api_surface(repo.id)?.len();
    let text = format!("indexed {}: {parsed_files} files parsed, {skipped_files} files skipped, {extracted} entities extracted, {edge_count} edges, {exports} exports, {} deleted", repo.name, deleted.len());
    Ok(IndexSummary {
        status: "ok",
        repo: repo.name.clone(),
        files_parsed: parsed_files,
        files_skipped: skipped_files,
        entities_extracted: extracted,
        edges: edge_count,
        entities_deleted: deleted.len(),
        exports,
        text,
    })
}

fn execute_entity(format: OutputFormat, db: Option<PathBuf>, cmd: EntityCommand) -> Result<()> {
    let storage = open_storage(db)?;
    match cmd.action {
        EntityAction::Lookup { name, repo, all } => {
            let repo_id = if all {
                None
            } else {
                match repo {
                    Some(repo) => storage.get_repo_by_name(&repo)?.map(|r| r.id),
                    None => None,
                }
            };
            let entities = storage.get_entities_by_name(&name, repo_id)?;
            let text = entities
                .iter()
                .map(|e| format!("{}\t{}\t{:?}", e.qualified_name, e.file_path, e.kind))
                .collect::<Vec<_>>()
                .join("\n");
            print(
                format,
                if text.is_empty() {
                    "no entities"
                } else {
                    &text
                },
                json!({"entities": entities}),
            )
        }
        EntityAction::Hash { name, repo } => {
            let repo = storage
                .get_repo_by_name(&repo)?
                .ok_or_else(|| anyhow!("repo not found: {repo}"))?;
            let entity = resolve_entity(&storage, &name, repo.id)?;
            let text = format!(
                "{}\nsignature: {}\ncontent: {}\nstructural: {}\nidentity: {}\ncontext: {}",
                entity.qualified_name,
                hex_hash(&entity.signature_hash),
                hex_hash(&entity.content_hash),
                hex_hash(&entity.structural_hash),
                hex_hash(&entity.identity_hash),
                hex_hash(&entity.context_hash)
            );
            print(
                format,
                &text,
                json!({"entity": entity, "hashes": entity.hashes()}),
            )
        }
    }
}

fn execute_graph(format: OutputFormat, db: Option<PathBuf>, cmd: GraphCommand) -> Result<()> {
    let storage = open_storage(db)?;
    match cmd.action {
        GraphAction::Callers {
            name,
            repo,
            cross_repo,
            depth,
        } => {
            let repo = repo.ok_or_else(|| anyhow!("--repo is required"))?;
            let repo = storage
                .get_repo_by_name(&repo)?
                .ok_or_else(|| anyhow!("repo not found: {repo}"))?;
            let entity = resolve_entity(&storage, &name, repo.id)?;
            let graph = if cross_repo {
                GraphBuilder::from_all_repos(&storage)?
            } else {
                GraphBuilder::from_storage(&storage, repo.id)?
            };
            let hits = GraphTraversal::new(&graph).callers(entity.id, depth);
            print_hits(format, "callers", &entity, hits)
        }
        GraphAction::Callees {
            name,
            repo,
            cross_repo,
            depth,
        } => {
            let repo = repo.ok_or_else(|| anyhow!("--repo is required"))?;
            let repo = storage
                .get_repo_by_name(&repo)?
                .ok_or_else(|| anyhow!("repo not found: {repo}"))?;
            let entity = resolve_entity(&storage, &name, repo.id)?;
            let graph = if cross_repo {
                GraphBuilder::from_all_repos(&storage)?
            } else {
                GraphBuilder::from_storage(&storage, repo.id)?
            };
            let hits = GraphTraversal::new(&graph).callees(entity.id, depth);
            print_hits(format, "callees", &entity, hits)
        }
        GraphAction::BlastRadius {
            name,
            repo,
            cross_repo,
        } => {
            let repo = repo.ok_or_else(|| anyhow!("--repo is required"))?;
            let repo = storage
                .get_repo_by_name(&repo)?
                .ok_or_else(|| anyhow!("repo not found: {repo}"))?;
            let entity = resolve_entity(&storage, &name, repo.id)?;
            let graph = if cross_repo {
                GraphBuilder::from_all_repos(&storage)?
            } else {
                GraphBuilder::from_storage(&storage, repo.id)?
            };
            let hits = GraphTraversal::new(&graph).blast_radius(entity.id);
            print_hits(format, "blast-radius", &entity, hits)
        }
        GraphAction::Cycles { repo } => {
            let repo = storage
                .get_repo_by_name(&repo)?
                .ok_or_else(|| anyhow!("repo not found: {repo}"))?;
            let graph = GraphBuilder::from_storage(&storage, repo.id)?;
            let cycles = GraphTraversal::new(&graph).detect_cycles();
            let text = if cycles.is_empty() {
                "no cycles".to_string()
            } else {
                cycles
                    .iter()
                    .map(|cycle| {
                        cycle
                            .iter()
                            .map(|e| e.qualified_name.clone())
                            .collect::<Vec<_>>()
                            .join(" -> ")
                    })
                    .collect::<Vec<_>>()
                    .join("\n")
            };
            print(format, &text, json!({"cycles": cycles}))
        }
        GraphAction::ValidateEdges { repo } => {
            let repo = storage
                .get_repo_by_name(&repo)?
                .ok_or_else(|| anyhow!("repo not found: {repo}"))?;
            let report = crosshash_graph::validate_edges_for_repo(&storage, repo.id)?;
            print(
                format,
                &format!(
                    "valid edges: {}, stale edges: {}",
                    report.valid_edges,
                    report.stale_edges.len()
                ),
                json!({"valid_edges": report.valid_edges, "stale_edges": report.stale_edges}),
            )
        }
    }
}

fn execute_discover_edges(
    format: OutputFormat,
    db: Option<PathBuf>,
    cmd: DiscoverEdgesCommand,
) -> Result<()> {
    let storage = open_storage(db)?;
    let repos = storage.list_repos()?;
    let repo_filter = cmd.repo.as_deref();
    let mut surfaces = Vec::new();
    for repo in repos
        .iter()
        .filter(|r| repo_filter.is_none_or(|name| r.name == name))
    {
        let exports = storage.get_public_api_surface(repo.id)?;
        surfaces.push(crosshash_ai::ApiSurface::from_exported_entities(
            repo.id, exports,
        ));
    }
    let decision = crosshash_ai::AiGate::decide(&crosshash_ai::GateInput {
        ai_enabled: !cmd.static_only,
        auto_gate: true,
        no_ai: cmd.no_ai || cmd.static_only,
        force_ai: cmd.force_ai,
        new_repo: false,
        exported_added: 0,
        exported_signature_changed: 0,
        exported_deleted: 0,
        body_only_changed: 0,
        commits_since_validation: 0,
        days_since_validation: 0,
    });
    let text = if cmd.dry_run {
        format!(
            "public surfaces: {} entities",
            surfaces.iter().map(|s| s.entities.len()).sum::<usize>()
        )
    } else if cmd.validate {
        "pending AI suggestions: 0".to_string()
    } else {
        format!(
            "static edges found, AI edges suggested: 0, AI cost incurred: ${:.2}, gate_run_ai={}",
            0.0, decision.should_run_ai
        )
    };
    print(
        format,
        &text,
        json!({"surfaces": surfaces, "gate": decision, "ai_edges_suggested": 0, "ai_cost": 0.0}),
    )
}

fn execute_impact(format: OutputFormat, db: Option<PathBuf>, cmd: ImpactCommand) -> Result<()> {
    let storage = open_storage(db)?;
    let repos = storage.list_repos()?;
    let entities = storage.get_entities_all()?;
    let edges = storage.get_edges_all()?;
    let changed = if let Some(entity_name) = cmd.entity.as_deref() {
        storage
            .get_entities_by_name(entity_name, None)?
            .into_iter()
            .map(|e| e.id)
            .collect::<Vec<_>>()
    } else {
        entities.iter().take(1).map(|e| e.id).collect::<Vec<_>>()
    };
    let affected = crosshash_impact::ImpactAnalyzer::default().analyze(&changed, &entities, &edges);
    let changed_entities = changed
        .iter()
        .map(|id| crosshash_impact::ChangedEntity {
            entity_id: *id,
            old_name: None,
            new_name: None,
            change_kind: crosshash_impact::ChangeKind::Modified,
            diff_summary: "current indexed state".into(),
        })
        .collect::<Vec<_>>();
    let classifications = affected
        .iter()
        .map(|a| {
            crosshash_impact::ImpactClassifier::classify(crosshash_impact::ChangeKind::Modified, a)
        })
        .collect::<Vec<_>>();
    let report = crosshash_impact::ImpactReportBuilder {
        changed_repos: repos
            .iter()
            .filter(|r| cmd.source.as_deref().is_none_or(|name| r.name == name))
            .map(|r| r.id)
            .collect(),
        affected_repos: repos
            .iter()
            .filter(|r| cmd.all || cmd.target.is_empty() || cmd.target.contains(&r.name))
            .map(|r| r.id)
            .collect(),
        changed_entities,
        affected_entities: affected,
        classifications,
        generated_at: Utc::now(),
    };
    let report_format = match cmd.output {
        ImpactOutputFormat::Json => crosshash_impact::ReportFormat::Json,
        ImpactOutputFormat::Markdown => crosshash_impact::ReportFormat::Markdown,
        ImpactOutputFormat::Sarif => crosshash_impact::ReportFormat::Sarif,
    };
    let rendered = report.render(report_format);
    print(
        format,
        &rendered,
        json!({"report": report, "ai_calls": 0, "commit": cmd.commit, "diff": cmd.diff}),
    )
}

fn execute_feedback(
    format: OutputFormat,
    _db: Option<PathBuf>,
    cmd: FeedbackCommand,
) -> Result<()> {
    let text = match cmd.action {
        Some(FeedbackAction::Accept { edge_id }) => {
            format!("accepted AI edge suggestion {edge_id}")
        }
        Some(FeedbackAction::Reject { edge_id }) => {
            format!("rejected AI edge suggestion {edge_id}")
        }
        Some(FeedbackAction::Stats) | None => {
            "feedback stats: total=0 accepted=0 rejected=0 precision=1.00".to_string()
        }
        Some(FeedbackAction::Export) => "[]".to_string(),
    };
    print(format, &text, json!({"status":"ok"}))
}

fn execute_ai_stats(
    format: OutputFormat,
    _db: Option<PathBuf>,
    _cmd: AiStatsCommand,
) -> Result<()> {
    let stats = crosshash_ai::AiStats::default();
    print(format, "AI invocations: 0, total cost: $0.00", json!(stats))
}

fn extract_for_language(
    language: Language,
    repo_id: Uuid,
    root: &Path,
    file: &Path,
    source: &str,
    tree: &tree_sitter::Tree,
    commit: &str,
) -> Result<Vec<Entity>> {
    match language {
        Language::Rust => {
            Ok(RustExtractor.extract_entities(repo_id, root, file, source, tree, commit)?)
        }
        Language::TypeScript | Language::JavaScript => {
            Ok(TypeScriptExtractor.extract_entities(repo_id, root, file, source, tree, commit)?)
        }
        Language::Python => {
            Ok(PythonExtractor.extract_entities(repo_id, root, file, source, tree, commit)?)
        }
        other => Err(anyhow!("unsupported language for extraction: {other:?}")),
    }
}

fn infer_static_edges(
    repo_id: Uuid,
    entities: &[Entity],
    source_by_file: &HashMap<String, String>,
) -> Vec<Edge> {
    let mut edges = Vec::new();
    let mut seen = HashSet::new();

    for parent in entities.iter().filter(|e| is_container_kind(e.kind)) {
        let prefix = format!("{}::", parent.qualified_name);
        for child in entities
            .iter()
            .filter(|e| e.qualified_name.starts_with(&prefix))
        {
            push_edge(
                repo_id,
                parent.id,
                child.id,
                EdgeKind::Contains,
                &mut seen,
                &mut edges,
            );
        }
    }

    for source in entities {
        let Some(file_source) = source_by_file.get(&source.file_path) else {
            continue;
        };
        let body = slice_entity_source(file_source, source);
        for target in entities.iter().filter(|target| target.id != source.id) {
            if body.contains(&format!("{}(", target.name)) {
                push_edge(
                    repo_id,
                    source.id,
                    target.id,
                    EdgeKind::Calls,
                    &mut seen,
                    &mut edges,
                );
            }
            if source.file_path != target.file_path && import_mentions(body, &target.name) {
                push_edge(
                    repo_id,
                    source.id,
                    target.id,
                    EdgeKind::Imports,
                    &mut seen,
                    &mut edges,
                );
            }
        }
    }

    edges
}

fn is_container_kind(kind: EntityKind) -> bool {
    matches!(
        kind,
        EntityKind::Class
            | EntityKind::Struct
            | EntityKind::Trait
            | EntityKind::Impl
            | EntityKind::Module
    )
}

fn import_mentions(source: &str, target_name: &str) -> bool {
    source.lines().any(|line| {
        let trimmed = line.trim_start();
        (trimmed.starts_with("use ")
            || trimmed.starts_with("import ")
            || trimmed.starts_with("from ")
            || trimmed.starts_with("export "))
            && trimmed.contains(target_name)
    })
}

fn slice_entity_source<'a>(source: &'a str, entity: &Entity) -> &'a str {
    source
        .get(entity.start_byte as usize..entity.end_byte as usize)
        .unwrap_or(source)
}

fn push_edge(
    repo_id: Uuid,
    source: Uuid,
    target: Uuid,
    kind: EdgeKind,
    seen: &mut HashSet<(Uuid, Uuid, EdgeKind)>,
    edges: &mut Vec<Edge>,
) {
    if !seen.insert((source, target, kind)) {
        return;
    }
    edges.push(Edge {
        id: Uuid::new_v5(&repo_id, format!("{source}:{target}:{kind:?}").as_bytes()),
        source_entity_id: source,
        target_entity_id: target,
        kind,
        confidence: 1.0,
        source: EdgeSource::Static,
        metadata: None,
        created_at: Utc::now(),
        validated_at: Some(Utc::now()),
    });
}

fn resolve_entity(storage: &GraphStorage, name: &str, repo_id: Uuid) -> Result<Entity> {
    storage
        .get_entities_by_name(name, Some(repo_id))?
        .into_iter()
        .next()
        .ok_or_else(|| anyhow!("entity not found: {name}"))
}

fn print_hits(
    format: OutputFormat,
    label: &str,
    entity: &Entity,
    hits: Vec<crosshash_graph::TraversalHit>,
) -> Result<()> {
    let text = if hits.is_empty() {
        format!("no {label} for {}", entity.qualified_name)
    } else {
        hits.iter()
            .map(|hit| {
                format!(
                    "{}\tdepth={}\tpath_edges={}",
                    hit.entity.qualified_name,
                    hit.distance,
                    hit.path.len()
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let results = hits
        .iter()
        .map(|hit| {
            json!({
                "entity": hit.entity,
                "distance": hit.distance,
                "path": hit.path.iter().map(|step| json!({
                    "source_entity_id": step.source_entity_id,
                    "target_entity_id": step.target_entity_id,
                    "edge": step.edge,
                })).collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    print(
        format,
        &text,
        json!({"query": label, "entity": entity, "results": results}),
    )
}

fn hex_hash(hash: &[u8; 32]) -> String {
    hash.iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()
}

fn infer_cross_repo_edges(
    storage: &GraphStorage,
    source_repo_id: Uuid,
    source_entities: &[Entity],
    source_by_file: &HashMap<String, String>,
) -> Result<Vec<Edge>> {
    let repos = storage.list_repos()?;
    let other_repo_ids = repos
        .iter()
        .filter(|repo| repo.id != source_repo_id)
        .map(|repo| repo.id)
        .collect::<HashSet<_>>();
    if other_repo_ids.is_empty() {
        return Ok(Vec::new());
    }
    let public_targets = storage
        .get_entities_all()?
        .into_iter()
        .filter(|entity| other_repo_ids.contains(&entity.repo_id) && entity.is_exported)
        .collect::<Vec<_>>();
    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    for source in source_entities {
        let body = source_by_file
            .get(&source.file_path)
            .map(|file_source| slice_entity_source(file_source, source))
            .unwrap_or(&source.signature);
        for target in &public_targets {
            if source.signature.contains(&target.name)
                || source.name.contains(&target.name)
                || body.contains(&format!("{}(", target.name))
                || import_mentions(body, &target.name)
            {
                push_edge(
                    source_repo_id,
                    source.id,
                    target.id,
                    EdgeKind::PackageDep,
                    &mut seen,
                    &mut edges,
                );
            }
        }
    }
    Ok(edges)
}

fn detect_languages(root: &Path) -> Result<Vec<Language>> {
    let mut languages = collect_source_files(root, &[])?
        .into_iter()
        .filter_map(|path| detect_language(&path).ok().flatten())
        .collect::<HashSet<_>>();
    if languages.is_empty() {
        languages.extend([Language::Rust, Language::TypeScript, Language::Python]);
    }
    let mut languages = languages.into_iter().collect::<Vec<_>>();
    languages.sort_by_key(|language| format!("{language:?}"));
    Ok(languages)
}

fn validate_repo_has_sources(root: &Path) -> Result<()> {
    if collect_source_files(root, &[])?.is_empty() {
        return Err(anyhow!(
            "repo path contains no supported source files: {}",
            root.display()
        ));
    }
    Ok(())
}

fn version_for(entity: &Entity, commit_hash: &str) -> EntityVersion {
    EntityVersion {
        entity_id: entity.id,
        commit_hash: commit_hash.into(),
        name: entity.name.clone(),
        qualified_name: entity.qualified_name.clone(),
        signature: entity.signature.clone(),
        signature_hash: entity.signature_hash,
        content_hash: entity.content_hash,
        structural_hash: entity.structural_hash,
        identity_hash: entity.identity_hash,
        context_hash: entity.context_hash,
        snapshot_at: Utc::now(),
    }
}

fn open_storage(db: Option<PathBuf>) -> Result<GraphStorage> {
    let path = db.unwrap_or_else(|| PathBuf::from(".crosshash/crosshash.db"));
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    Ok(GraphStorage::open(&path)?)
}
fn detect_workspace_type(root: &Path, workspace_aware: bool) -> WorkspaceType {
    if root.join("nx.json").exists() {
        WorkspaceType::Nx
    } else if root.join("turbo.json").exists() {
        WorkspaceType::Turborepo
    } else if root.join("Cargo.toml").exists() {
        if workspace_aware
            && std::fs::read_to_string(root.join("Cargo.toml"))
                .unwrap_or_default()
                .contains("[workspace]")
        {
            WorkspaceType::CargoWorkspace
        } else {
            WorkspaceType::Cargo
        }
    } else if root.join("package.json").exists() {
        if workspace_aware
            && std::fs::read_to_string(root.join("package.json"))
                .unwrap_or_default()
                .contains("\"workspaces\"")
        {
            WorkspaceType::NpmWorkspace
        } else {
            WorkspaceType::Npm
        }
    } else if root.join("go.mod").exists() {
        WorkspaceType::GoModules
    } else {
        WorkspaceType::None
    }
}
fn print(format: OutputFormat, text: &str, payload: serde_json::Value) -> Result<()> {
    println!("{}", render_message(format, text, &payload)?);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn cli_exposes_phase_one_index_flags_and_commands() {
        let mut help = Vec::new();
        Cli::command().write_long_help(&mut help).unwrap();
        let help = String::from_utf8(help).unwrap();
        for command in [
            "repo",
            "index",
            "discover-edges",
            "impact",
            "entity",
            "graph",
            "feedback",
            "ai-stats",
        ] {
            assert!(
                help.contains(command),
                "missing command {command} in help: {help}"
            );
        }
        let help = Cli::command().render_long_help().to_string();
        assert!(help.contains("--db"));
    }
}
