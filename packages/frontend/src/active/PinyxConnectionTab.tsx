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
  const isAutoDetected = (config as any).autoDetected === true && config.endpoint !== "";
  const [endpoint, setEndpoint] = useState(config.endpoint);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelsExpanded, setModelsExpanded] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [showEndpointInput, setShowEndpointInput] = useState(!isAutoDetected);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    setEndpoint(config.endpoint);
  }, [config.endpoint]);

  useEffect(() => {
    return () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
  }, []);

  async function handleTestAndSave() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    const start = performance.now();

    try {
      const updatedConfig = { ...config, endpoint };
      await savePinyxConfig(updatedConfig);
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
      onConfigUpdate(updatedConfig);
      setSavedFlash(true);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg.includes("502") ? "PiNyx endpoint is unreachable" : msg);
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
            <p className="pinyx-section-desc">
              {isAutoDetected
                ? "Auto-detected from your Docker environment."
                : "LLM orchestration layer"}
            </p>
          </div>
        </div>

        {isAutoDetected && !showEndpointInput && (
          <div style={{ marginBottom: "12px" }}>
            <div className="pinyx-status-row">
              <span className="pinyx-status-dot pinyx-status-dot--success" />
              <span style={{ color: "var(--text-secondary)", fontFamily: '"JetBrains Mono", monospace', fontSize: "11px" }}>
                {endpoint}
              </span>
              <button
                className="pinyx-status-models-toggle"
                onClick={() => setShowEndpointInput(true)}
                style={{ marginLeft: "8px" }}
              >
                change
              </button>
            </div>
          </div>
        )}

        {(showEndpointInput || !isAutoDetected) && (
          <>
            <label className="pinyx-label">Endpoint</label>
            <input
              className="pinyx-input"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://127.0.0.1:7331"
            />
          </>
        )}

        <div className="pinyx-btn-group">
          <button
            className="pinyx-btn-outline"
            onClick={() => void handleTestAndSave()}
            disabled={testing || !endpoint.trim()}
          >
            {testing ? "Testing..." : "Test & Save"}
          </button>
        </div>

        {savedFlash && (
          <div className="pinyx-saved-flash">
            Saved ✓ {testResult ? `${testResult.latencyMs}ms` : ""}
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
