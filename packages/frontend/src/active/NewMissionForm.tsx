import { useNewMissionForm } from "./useNewMissionForm";

interface NewMissionFormProps {
  onSubmit: (description: string) => Promise<void>;
}

export function NewMissionForm({ onSubmit }: NewMissionFormProps) {
  const { state, open, close, setDescription, handleSubmit, handleKeyDown, canSubmit } = useNewMissionForm(onSubmit);

  if (!state.open) {
    return (
      <button
        onClick={open}
        style={{
          width: "calc(100% - 32px)",
          padding: "8px 16px",
          margin: "12px 16px",
          background: "var(--accent)",
          color: "var(--bg-deep)",
          border: "none",
          borderRadius: "4px",
          fontSize: "12px",
          fontWeight: 600,
          fontFamily: '"JetBrains Mono", monospace',
          letterSpacing: "1px",
          textTransform: "uppercase" as const,
          cursor: "pointer",
          textAlign: "left" as const,
        }}
      >
        + NEW MISSION
      </button>
    );
  }

  return (
    <div style={{ padding: "8px 16px", borderBottom: "1px solid var(--border)" }}>
      <textarea
        value={state.description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want done..."
        style={{
          width: "100%",
          background: "var(--bg-inset)",
          color: "var(--text-primary)",
          fontSize: "14px",
          borderRadius: "4px",
          padding: "8px",
          border: "1px solid var(--border)",
          outline: "none",
          resize: "none",
          fontFamily: '"Inter", sans-serif',
        }}
        rows={3}
        autoFocus
        disabled={state.submitting}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px" }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: "4px 12px",
            fontSize: "12px",
            background: canSubmit ? "var(--accent)" : "var(--bg-elevated)",
            color: canSubmit ? "var(--bg-deep)" : "var(--text-muted)",
            border: "none",
            borderRadius: "4px",
            cursor: canSubmit ? "pointer" : "default",
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          {state.submitting ? "Creating..." : "Create"}
        </button>
        <button
          onClick={close}
          style={{
            padding: "4px 12px",
            fontSize: "12px",
            color: "var(--text-secondary)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontFamily: '"JetBrains Mono", monospace',
          }}
        >
          Cancel
        </button>
      </div>
      {state.error && <p style={{ fontSize: "12px", color: "var(--error)", marginTop: "4px" }}>{state.error}</p>}
    </div>
  );
}
