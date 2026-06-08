import { useReducer, useCallback, useEffect } from "react";

export interface FormState {
  open: boolean;
  description: string;
  submitting: boolean;
  selectedCloneUrl?: string;
  selectedRepoId?: number | null;
  selectedRepoFullName?: string;
  error: string | null;
}

export type FormAction =
  | { type: "OPEN" }
  | { type: "OPEN_WITH_SUGGESTION"; description: string }
  | { type: "CLOSE" }
  | { type: "SET_DESCRIPTION"; value: string }
  | { type: "SET_REPO"; cloneUrl: string; repoId: number; fullName: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; error: string };

export const initialFormState: FormState = {
  open: false,
  description: "",
  submitting: false,
  selectedCloneUrl: undefined,
  selectedRepoId: null,
  selectedRepoFullName: undefined,
  error: null,
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "OPEN":
      return { ...initialFormState, open: true };
    case "OPEN_WITH_SUGGESTION":
      // Opens the form with a pre-filled description but preserves the
      // selected repo so missions started from suggestions keep their clone URL.
      return { ...initialFormState, open: true, description: action.description, selectedCloneUrl: state.selectedCloneUrl, selectedRepoId: state.selectedRepoId, selectedRepoFullName: state.selectedRepoFullName };
    case "CLOSE":
      return initialFormState;
    case "SET_DESCRIPTION":
      return { ...state, description: action.value };
    case "SET_REPO":
      return { ...state, selectedCloneUrl: action.cloneUrl, selectedRepoId: action.repoId, selectedRepoFullName: action.fullName };
    case "SUBMIT_START":
      return { ...state, submitting: true, error: null };
    case "SUBMIT_SUCCESS":
      return initialFormState;
    case "SUBMIT_ERROR":
      return { ...state, submitting: false, error: action.error };
    default:
      return state;
  }
}

export async function submitIfValid(
  description: string,
  submitting: boolean,
  onSubmit: (description: string, cloneUrl?: string) => Promise<void>,
  dispatch: React.Dispatch<FormAction>,
): Promise<void> {
  const trimmed = description.trim();
  if (!trimmed || submitting) return;
  dispatch({ type: "SUBMIT_START" });
  try {
    await onSubmit(trimmed);
    dispatch({ type: "SUBMIT_SUCCESS" });
  } catch (err) {
    dispatch({ type: "SUBMIT_ERROR", error: err instanceof Error ? err.message : "Failed to create mission" });
  }
}

export function useNewMissionForm(onSubmit: (description: string, cloneUrl?: string) => Promise<void>, suggestedDescription?: string) {
  const [state, dispatch] = useReducer(formReducer, initialFormState);

  useEffect(() => {
    if (suggestedDescription && !state.open) {
      dispatch({ type: "OPEN_WITH_SUGGESTION", description: suggestedDescription });
    }
  }, [suggestedDescription]);

  const handleSubmit = useCallback(() => {
    const submit = (description: string) => onSubmit(description, state.selectedCloneUrl);
    submitIfValid(state.description, state.submitting, submit, dispatch);
  }, [state.description, state.submitting, state.selectedCloneUrl, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const open = useCallback(() => dispatch({ type: "OPEN" }), []);
  const openWithSuggestion = useCallback((description: string) => dispatch({ type: "OPEN_WITH_SUGGESTION", description }), []);
  const close = useCallback(() => dispatch({ type: "CLOSE" }), []);
  const setDescription = useCallback((value: string) => dispatch({ type: "SET_DESCRIPTION", value }), []);
  const setRepo = useCallback((cloneUrl: string, repoId: number, fullName: string) => dispatch({ type: "SET_REPO", cloneUrl, repoId, fullName }), []);

  return {
    state,
    open,
    openWithSuggestion,
    close,
    setDescription,
    setRepo,
    handleSubmit,
    handleKeyDown,
    canSubmit: state.description.trim().length > 0 && !state.submitting,
  };
}
