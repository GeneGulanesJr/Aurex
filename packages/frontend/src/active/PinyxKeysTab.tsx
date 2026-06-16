import { useState, useRef, useEffect } from "react";
import { savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface PinyxKeysTabProps {
  config: PinyxConfigResponse;
  onConfigUpdate: (config: PinyxConfigResponse) => void;
}

interface ProviderDraft {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
}

const EMPTY_DRAFT: ProviderDraft = { id: "", name: "", baseUrl: "", apiKey: "" };

const BUILT_IN_PROVIDERS = [
  { id: "kilo", name: "Kilo Code", baseUrl: "https://api.kilo.ai/v1" },
  { id: "zai", name: "Z.AI Coding", baseUrl: "https://api.z.ai/api/coding/paas/v4" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.io/v1" },
];

export function PinyxKeysTab({ config, onConfigUpdate }: PinyxKeysTabProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  // Merge built-in providers with user-added ones.
  // Built-ins are always shown; user providers from config are appended.
  const builtInRows = BUILT_IN_PROVIDERS.map((bp) => {
    const existing = config.providers.find((p) => p.id === bp.id);
    return {
      ...bp,
      hasApiKey: existing?.hasApiKey ?? false,
      isBuiltIn: true,
    };
  });

  const customProviders = config.providers.filter(
    (p) => !BUILT_IN_PROVIDERS.some((bp) => bp.id === p.id),
  );

  const allProviders = [...builtInRows, ...customProviders.map((p) => ({ ...p, isBuiltIn: false }))];

  function startEdit(index: number) {
    const p = allProviders[index];
    setDraft({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: "",
    });
    setEditingIndex(index);
    setAdding(false);
  }

  function startAdd() {
    setDraft(EMPTY_DRAFT);
    setAdding(true);
    setEditingIndex(null);
  }

  function cancel() {
    setDraft(EMPTY_DRAFT);
    setEditingIndex(null);
    setAdding(false);
  }

  async function handleDelete(index: number) {
    const provider = allProviders[index];
    if (!provider || provider.isBuiltIn) return;
    setSaving(true);
    setError(null);
    try {
      const providers = config.providers.filter((p) => p.id !== provider.id);
      const saved = await savePinyxConfig({ ...config, providers });
      onConfigUpdate(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete provider");
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      // Build the final providers list:
      // - Built-in providers always included (with key if provided)
      // - Custom providers preserved
      let providers = BUILT_IN_PROVIDERS.map((bp) => {
        const existing = config.providers.find((p) => p.id === bp.id);
        if (editingIndex !== null && allProviders[editingIndex]?.id === bp.id) {
          // Editing this built-in — update with new key
          return {
            id: bp.id,
            name: bp.name,
            baseUrl: bp.baseUrl,
            ...(draft.apiKey ? { apiKey: draft.apiKey } : existing?.hasApiKey ? {} : {}),
            ...(existing?.hasApiKey && !draft.apiKey ? { hasApiKey: true } : {}),
          };
        }
        return {
          id: bp.id,
          name: bp.name,
          baseUrl: bp.baseUrl,
          ...(existing?.hasApiKey ? { hasApiKey: true } : {}),
        };
      });

      // Add custom providers
      const existingCustom = config.providers.filter(
        (p) => !BUILT_IN_PROVIDERS.some((bp) => bp.id === p.id),
      );

      if (adding) {
        providers = [...providers, ...existingCustom, {
          id: draft.id,
          name: draft.name,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey || undefined,
        }];
      } else if (editingIndex !== null) {
        const editingBuiltIn = allProviders[editingIndex]?.isBuiltIn;
        if (editingBuiltIn) {
          // Update the built-in provider with new key
          const biIndex = BUILT_IN_PROVIDERS.findIndex((bp) => bp.id === draft.id);
          if (biIndex >= 0) {
            providers[biIndex] = {
              id: draft.id,
              name: draft.name,
              baseUrl: draft.baseUrl,
              ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
            };
          }
          providers = [...providers.filter((p) => !existingCustom.some((ec) => ec.id === p.id)), ...existingCustom];
        } else {
          // Editing a custom provider
          const customIndex = editingIndex - builtInRows.length;
          if (customIndex >= 0 && customIndex < existingCustom.length) {
            existingCustom[customIndex] = {
              ...existingCustom[customIndex],
              id: draft.id,
              name: draft.name,
              baseUrl: draft.baseUrl,
              ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
            };
          }
          providers = [...providers.filter((p) => !existingCustom.some((ec) => ec.id === p.id)), ...existingCustom];
        }
      } else {
        providers = [...providers.filter((p) => !existingCustom.some((ec) => ec.id === p.id)), ...existingCustom];
      }

      const saved = await savePinyxConfig({ ...config, providers });
      onConfigUpdate(saved);
      cancel();
      setSavedFlash(true);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const isEditing = editingIndex !== null || adding;
  const isEditingBuiltIn = editingIndex !== null && allProviders[editingIndex]?.isBuiltIn;

  return (
    <div>
      <div className="pinyx-section">
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "12px" }}>
          API keys for LLM providers. Built-in providers just need your key.
        </p>

        <div className="pinyx-provider-table">
          {allProviders.map((provider, index) => (
            <div key={`${provider.id}-${index}`} className="pinyx-provider-row">
              <div>
                <div className="pinyx-provider-id">
                  {provider.name}
                  {provider.isBuiltIn && (
                    <span className="pinyx-provider-built-in-badge">built-in</span>
                  )}
                </div>
                <div className="pinyx-provider-url">{provider.baseUrl}</div>
              </div>
              <div className={`pinyx-provider-key-badge${provider.hasApiKey ? " pinyx-provider-key-badge--saved" : ""}`}>
                <span className={`pinyx-status-dot ${provider.hasApiKey ? "pinyx-status-dot--success" : "pinyx-status-dot--muted"}`} />
                {provider.hasApiKey ? "Saved" : "No key"}
              </div>
              <button
                className="pinyx-provider-edit-btn"
                onClick={() => startEdit(index)}
                title={provider.isBuiltIn ? "Set API key" : "Edit provider"}
              >
                {provider.isBuiltIn && !provider.hasApiKey ? "＋" : "✎"}
              </button>
              {!provider.isBuiltIn && (
                <button
                  className="pinyx-provider-edit-btn"
                  onClick={() => void handleDelete(index)}
                  title="Delete provider"
                  disabled={saving}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>

        {!isEditing && (
          <div className="pinyx-btn-group">
            <button className="pinyx-btn-outline" onClick={startAdd}>
              + Add Custom Provider
            </button>
          </div>
        )}

        {isEditing && (
          <div className="pinyx-provider-form">
            {isEditingBuiltIn ? (
              <>
                <div style={{ marginBottom: "8px" }}>
                  <span style={{ color: "var(--text-primary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "12px", fontWeight: 500 }}>
                    {draft.name}
                  </span>
                  <span style={{ color: "var(--text-muted)", fontFamily: '"JetBrains Mono", monospace', fontSize: "10px", marginLeft: "8px" }}>
                    {draft.baseUrl}
                  </span>
                </div>
                <label className="pinyx-label">API Key</label>
                <input
                  className="pinyx-input"
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder={
                    allProviders[editingIndex!]?.hasApiKey
                      ? "Enter new key to replace"
                      : "API key"
                  }
                />
              </>
            ) : (
              <>
                <label className="pinyx-label">Provider ID</label>
                <input
                  className="pinyx-input"
                  value={draft.id}
                  onChange={(e) => setDraft({ ...draft, id: e.target.value })}
                  placeholder="openai"
                />

                <label className="pinyx-label">Display Name</label>
                <input
                  className="pinyx-input"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="OpenAI"
                />

                <label className="pinyx-label">Base URL</label>
                <input
                  className="pinyx-input"
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                />

                <label className="pinyx-label">API Key</label>
                <input
                  className="pinyx-input"
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="API key"
                />
              </>
            )}

            <div className="pinyx-btn-group">
              <button
                className="pinyx-btn-primary"
                disabled={saving || (!isEditingBuiltIn && (!draft.id.trim() || !draft.baseUrl.trim())) || (isEditingBuiltIn && !draft.apiKey.trim())}
                onClick={() => void handleSave()}
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button className="pinyx-btn-outline" onClick={cancel}>
                Cancel
              </button>
            </div>
          </div>
        )}

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
