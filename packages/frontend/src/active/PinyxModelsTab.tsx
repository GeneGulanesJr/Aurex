import { useState, useEffect, useRef } from "react";
import { getPinyxModels, savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface PinyxModelsTabProps {
  config: PinyxConfigResponse;
  onConfigUpdate: (config: PinyxConfigResponse) => void;
}

const AGENT_CARDS = [
  { key: "orchestrator", name: "Orchestrator", description: "Plans missions and decomposes goals into milestones", types: ["orchestrator"] },
  { key: "worker", name: "Worker", description: "Writes code and implements working units", types: ["worker"] },
  { key: "validator", name: "Validator", description: "Reviews code quality and runs test suites", types: ["validator_scrutiny", "validator_user_testing"] },
  { key: "research", name: "Research", description: "Gathers context and investigates solutions", types: ["research"] },
];

// Backend sentinel for "no model selected". Centralized so the contract with
// the model discovery service is documented in one place and a real model id
// could never accidentally collide with the unset marker.
const UNSET_MODEL_SENTINEL = "kilo/kilo-auto/free";
const isUnsetModel = (value: string | null | undefined): boolean =>
  !value || value === UNSET_MODEL_SENTINEL;

export function PinyxModelsTab({ config, onConfigUpdate }: PinyxModelsTabProps) {
  const hasKeys = config.providers.some((p) => p.hasApiKey);

  const [modelHints, setModelHints] = useState(config.modelHints);
  const [defaultModel, setDefaultModel] = useState(() => {
    // Use first model hint value if available, otherwise empty
    const first = config.modelHints.orchestrator;
    return isUnsetModel(first) ? "" : first;
  });
  const [models, setModels] = useState<Array<{ id?: string; name?: string }>>([]);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  const [overrides, setOverrides] = useState<Record<string, string | null>>(() => {
    const result: Record<string, string | null> = {};
    for (const card of AGENT_CARDS) {
      const agentModel = config.modelHints[card.types[0] as keyof typeof config.modelHints];
      result[card.key] = (!agentModel || agentModel === defaultModel) ? null : agentModel;
    }
    return result;
  });

  const dirty = JSON.stringify(modelHints) !== JSON.stringify(config.modelHints);

  useEffect(() => {
    if (!hasKeys) {
      setModels([]);
      return;
    }
    getPinyxModels()
      .then((res) => {
        setModels(res.models);
        const options = res.models.map((m) => m.id ?? m.name ?? "").filter(Boolean);
        if (!options.length) return;

        const current = config.modelHints.orchestrator;
        const shouldAutoSelect = isUnsetModel(current) || !options.includes(current);
        if (!shouldAutoSelect) return;

        const nextDefault = options[0];
        setDefaultModel(nextDefault);
        const updated = { ...config.modelHints };
        for (const card of AGENT_CARDS) {
          for (const t of card.types) {
            (updated as Record<string, string>)[t] = nextDefault;
          }
        }
        setModelHints(updated);
        setOverrides(Object.fromEntries(AGENT_CARDS.map((card) => [card.key, null])));
      })
      .catch(() => setModels([]));
  }, [hasKeys, config.modelHints]);

  useEffect(() => {
    setModelHints(config.modelHints);
    const first = config.modelHints.orchestrator;
    setDefaultModel(isUnsetModel(first) ? "" : first);
  }, [config.modelHints]);

  function handleDefaultChange(newDefault: string) {
    setDefaultModel(newDefault);
    const updated = { ...modelHints };
    for (const card of AGENT_CARDS) {
      if (!overrides[card.key]) {
        for (const t of card.types) {
          (updated as Record<string, string>)[t] = newDefault;
        }
      }
    }
    setModelHints(updated);
  }

  function handleOverride(cardKey: string, value: string | null) {
    const card = AGENT_CARDS.find((c) => c.key === cardKey);
    if (!card) return;
    setOverrides((prev) => ({ ...prev, [cardKey]: value }));
    const updated = { ...modelHints };
    const model = value ?? defaultModel;
    for (const t of card.types) {
      (updated as Record<string, string>)[t] = model;
    }
    setModelHints(updated);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const saved = await savePinyxConfig({ ...config, modelHints });
      onConfigUpdate(saved);
      setSavedFlash(true);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function getCardModel(cardKey: string): string {
    const card = AGENT_CARDS.find((c) => c.key === cardKey);
    if (!card) return defaultModel;
    const value = modelHints[card.types[0] as keyof typeof modelHints];
    if (isUnsetModel(value)) return defaultModel;
    return value;
  }

  const modelOptions = models.map((m) => m.id ?? m.name ?? "").filter(Boolean);

  if (!hasKeys) {
    return (
      <div>
        <div className="pinyx-section">
          <div style={{ textAlign: "center", padding: "24px 16px" }}>
            <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: "0 0 8px" }}>
              No providers configured yet.
            </p>
            <p style={{ color: "var(--text-secondary)", fontSize: "13px", margin: 0 }}>
              Add an API key for Kilo Code or Z.AI in the <strong>Keys</strong> tab first, then models will appear here.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="pinyx-section">
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "12px" }}>
          Model routing — auto-detect with per-agent overrides.
        </p>

        {modelOptions.length > 0 ? (
          <>
          <div className="pinyx-model-default">
            <div className="pinyx-model-default-label">Default Model</div>
            <select
              value={defaultModel}
              onChange={(e) => handleDefaultChange(e.target.value)}
            >
              {modelOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
          {dirty && (
            <p style={{ color: "var(--warning)", fontSize: "11px", margin: "8px 0 0" }}>
              Discovered models from PiNyx. Save model routing to use {defaultModel} for scans and analysis.
            </p>
          )}
          </>
        ) : (
          <div className="pinyx-model-default">
            <div className="pinyx-model-default-label">Default Model</div>
            <p style={{ color: "var(--text-muted)", fontSize: "11px", margin: "4px 0 0" }}>
              Connect to PiNyx in the Connection tab to discover available models.
            </p>
          </div>
        )}

        {AGENT_CARDS.map((card) => {
          const model = getCardModel(card.key);
          const hasOverride = overrides[card.key] !== null;
          const isExpanded = expandedCard === card.key;

          return (
            <div
              key={card.key}
              className={`pinyx-agent-card${isExpanded ? " pinyx-agent-card--expanded" : ""}`}
              onClick={() => setExpandedCard(isExpanded ? null : card.key)}
            >
              <div className="pinyx-agent-card-header">
                <span className="pinyx-agent-name">{card.name}</span>
                <span className={`pinyx-agent-model${hasOverride ? " pinyx-agent-model--override" : " pinyx-agent-model--default"}`}>
                  {model || "unset"}
                </span>
              </div>

              {isExpanded && (
                <>
                  <p className="pinyx-agent-desc">{card.description}</p>
                  {modelOptions.length > 0 && (
                    <div className="pinyx-agent-override" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={hasOverride ? overrides[card.key]! : ""}
                        onChange={(e) => {
                          handleOverride(card.key, e.target.value === "" ? null : e.target.value);
                        }}
                      >
                        <option value="">Use default ({defaultModel})</option>
                        {modelOptions.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                      {hasOverride && (
                        <button
                          className="pinyx-agent-reset"
                          onClick={() => handleOverride(card.key, null)}
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}

        <div className="pinyx-btn-group">
          <button
            className="pinyx-btn-primary"
            disabled={!dirty || saving || !defaultModel}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving..." : "Save Model Routing"}
          </button>
        </div>

        {savedFlash && <div className="pinyx-saved-flash">Saved ✓</div>}

        {error && (
          <div className="pinyx-error-bar">
            <span>{error}</span>
            <button className="pinyx-error-bar-close" onClick={() => setError(null)}>×</button>
          </div>
        )}
      </div>
    </div>
  );
}
