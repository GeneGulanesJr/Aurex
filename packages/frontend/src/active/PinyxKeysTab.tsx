import { useState } from "react";
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

export function PinyxKeysTab({ config, onConfigUpdate }: PinyxKeysTabProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ProviderDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit(index: number) {
    const p = config.providers[index];
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

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const providers = [...config.providers];
      if (adding) {
        providers.push({
          id: draft.id,
          name: draft.name,
          baseUrl: draft.baseUrl,
          apiKey: draft.apiKey || undefined,
        });
      } else if (editingIndex !== null) {
        providers[editingIndex] = {
          ...providers[editingIndex],
          id: draft.id,
          name: draft.name,
          baseUrl: draft.baseUrl,
          ...(draft.apiKey ? { apiKey: draft.apiKey } : {}),
        };
      }
      const saved = await savePinyxConfig({ ...config, providers });
      onConfigUpdate(saved);
      cancel();
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  const isEditing = editingIndex !== null || adding;

  return (
    <div>
      <div className="pinyx-section">
        <p style={{ margin: "0 0 12px", color: "var(--text-secondary)", fontSize: "12px" }}>
          API keys for LLM providers.
        </p>

        {config.providers.length > 0 && (
          <div className="pinyx-provider-table">
            {config.providers.map((provider, index) => (
              <div key={`${provider.id}-${index}`} className="pinyx-provider-row">
                <div>
                  <div className="pinyx-provider-id">{provider.id}</div>
                  <div className="pinyx-provider-url">{provider.baseUrl}</div>
                </div>
                <div className={`pinyx-provider-key-badge${provider.hasApiKey ? " pinyx-provider-key-badge--saved" : ""}`}>
                  <span className={`pinyx-status-dot ${provider.hasApiKey ? "pinyx-status-dot--success" : "pinyx-status-dot--muted"}`} />
                  {provider.hasApiKey ? "Saved" : "No key"}
                </div>
                <button
                  className="pinyx-provider-edit-btn"
                  onClick={() => startEdit(index)}
                  title="Edit provider"
                >
                  ✎
                </button>
              </div>
            ))}
          </div>
        )}

        {!isEditing && (
          <div className="pinyx-btn-group">
            <button className="pinyx-btn-outline" onClick={startAdd}>
              + Add Provider
            </button>
          </div>
        )}

        {isEditing && (
          <div className="pinyx-provider-form">
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
              placeholder={
                editingIndex !== null && config.providers[editingIndex!]?.hasApiKey
                  ? "Enter new key to replace"
                  : "API key"
              }
            />

            <div className="pinyx-btn-group">
              <button
                className="pinyx-btn-primary"
                disabled={saving || !draft.id.trim() || !draft.baseUrl.trim()}
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
