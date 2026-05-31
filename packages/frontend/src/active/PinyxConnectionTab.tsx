import { useState, useEffect, useRef } from "react";
import { getPinyxModels, savePinyxConfig } from "../api";
import type { PinyxConfigResponse } from "../api";

interface PinyxConnectionTabProps {
  config: PinyxConfigResponse & { autoDetected?: boolean };
  onConfigUpdate: (config: PinyxConfigResponse) => void;
}

interface TestResult {
  success: boolean;
  latencyMs: number;
  modelCount: number;
  models: Array<{ id?: string; name?: string }>;
}

export function PinyxConnectionTab({ config, onConfigUpdate }: PinyxConnectionTabProps) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  async function handleCheckGateway() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    const start = performance.now();

    try {
      await savePinyxConfig(config);
      const saveLatency = Math.round(performance.now() - start);

      const modelStart = performance.now();
      const modelsRes = await getPinyxModels();
      const modelsLatency = Math.round(performance.now() - modelStart);
      const totalLatency = saveLatency + modelsLatency;

      const result: TestResult = {
        success: true,
        latencyMs: totalLatency,
        modelCount: modelsRes.models.length,
        models: modelsRes.models,
      };
      setTestResult(result);
      onConfigUpdate(config);
      setSavedFlash(true);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg.includes("502") ? "PiNyx gateway is unreachable" : msg);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <div className="pinyx-section">
        <div className="pinyx-section-header">
          <div>
            <h3 className="pinyx-section-title">PiNyx Gateway</h3>
            <p className="pinyx-section-desc">Docker-managed LLM orchestration layer.</p>
          </div>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <div className="pinyx-status-row">
            <span className="pinyx-status-dot pinyx-status-dot--success" />
            <span style={{ color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px" }}>
              Managed by Docker
            </span>
          </div>
        </div>

        <div className="pinyx-btn-group">
          <button
            className="pinyx-btn-outline"
            onClick={() => void handleCheckGateway()}
            disabled={testing || !config.endpoint.trim()}
          >
            {testing ? "Checking..." : "Check Gateway"}
          </button>
        </div>

        {savedFlash && (
          <div className="pinyx-saved-flash">
            Gateway OK ✓ {testResult ? `${testResult.latencyMs}ms` : ""}
          </div>
        )}

        {error && (
          <div className="pinyx-error-bar">
            <span>{error}</span>
            <button className="pinyx-error-bar-close" onClick={() => setError(null)}>×</button>
          </div>
        )}
      </div>

      {testResult && (
        <div className="pinyx-status-card">
          <div className="pinyx-status-row">
            <span className="pinyx-status-dot pinyx-status-dot--success" />
            <span>Connected</span>
            <span className="pinyx-status-latency">{testResult.latencyMs}ms</span>
          </div>
          <div style={{ marginTop: "8px" }}>
            <button
              className="pinyx-status-models-toggle"
              onClick={() => setModelsExpanded(!modelsExpanded)}
            >
              {testResult.modelCount} models available {modelsExpanded ? "▾" : "▸"}
            </button>
            {modelsExpanded && (
              <div className="pinyx-status-model-list">
                {testResult.models.map((m, i) => (
                  <div key={m.id ?? m.name ?? i}>{m.id ?? m.name ?? "unknown"}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
