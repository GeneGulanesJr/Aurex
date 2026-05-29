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
        className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-gray-800/50 transition-colors text-left"
      >
        + New Mission
      </button>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2 border-b border-gray-800">
      <textarea
        value={state.description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe what you want done..."
        className="w-full bg-gray-900 text-sm text-gray-200 rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 focus:outline-none resize-none placeholder-gray-600"
        rows={3}
        autoFocus
        disabled={state.submitting}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="px-3 py-1 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded transition-colors"
        >
          {state.submitting ? "Creating..." : "Create"}
        </button>
        <button
          onClick={close}
          className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 transition-colors"
        >
          Cancel
        </button>
      </div>
      {state.error && <p className="text-xs text-red-400">{state.error}</p>}
    </div>
  );
}
