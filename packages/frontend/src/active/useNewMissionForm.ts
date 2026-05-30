import { useReducer, useCallback } from "react";

export interface FormState {
  open: boolean;
  description: string;
  submitting: boolean;
  error: string | null;
}

export type FormAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "SET_DESCRIPTION"; value: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS" }
  | { type: "SUBMIT_ERROR"; error: string };

export const initialFormState: FormState = {
  open: false,
  description: "",
  submitting: false,
  error: null,
};

export function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "OPEN":
      return { ...initialFormState, open: true };
    case "CLOSE":
      return initialFormState;
    case "SET_DESCRIPTION":
      return { ...state, description: action.value };
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
  onSubmit: (description: string) => Promise<void>,
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

export function useNewMissionForm(onSubmit: (description: string) => Promise<void>) {
  const [state, dispatch] = useReducer(formReducer, initialFormState);

  const handleSubmit = useCallback(() => {
    submitIfValid(state.description, state.submitting, onSubmit, dispatch);
  }, [state.description, state.submitting, onSubmit]);

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
  const close = useCallback(() => dispatch({ type: "CLOSE" }), []);
  const setDescription = useCallback((value: string) => dispatch({ type: "SET_DESCRIPTION", value }), []);

  return {
    state,
    open,
    close,
    setDescription,
    handleSubmit,
    handleKeyDown,
    canSubmit: state.description.trim().length > 0 && !state.submitting,
  };
}
