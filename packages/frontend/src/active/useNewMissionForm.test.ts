import { describe, it, expect, vi } from "vitest";
import { formReducer, initialFormState } from "./useNewMissionForm";
import type { FormState } from "./useNewMissionForm";

describe("formReducer", () => {
  it("opens the form", () => {
    const state = formReducer(initialFormState, { type: "OPEN" });
    expect(state.open).toBe(true);
    expect(state.description).toBe("");
    expect(state.error).toBeNull();
  });

  it("closes and resets the form", () => {
    const state: FormState = { open: true, description: "some text", submitting: false, error: null };
    const next = formReducer(state, { type: "CLOSE" });
    expect(next.open).toBe(false);
    expect(next.description).toBe("");
    expect(next.error).toBeNull();
  });

  it("updates description", () => {
    const state = formReducer(initialFormState, { type: "SET_DESCRIPTION", value: "Build login" });
    expect(state.description).toBe("Build login");
  });

  it("sets submitting and clears error", () => {
    const state: FormState = { open: true, description: "test", submitting: false, error: "old error" };
    const next = formReducer(state, { type: "SUBMIT_START" });
    expect(next.submitting).toBe(true);
    expect(next.error).toBeNull();
  });

  it("sets error and clears submitting on failure", () => {
    const state: FormState = { open: true, description: "test", submitting: true, error: null };
    const next = formReducer(state, { type: "SUBMIT_ERROR", error: "Server error" });
    expect(next.submitting).toBe(false);
    expect(next.error).toBe("Server error");
    expect(next.open).toBe(true);
  });

  it("resets and closes on submit success", () => {
    const state: FormState = { open: true, description: "test", submitting: true, error: null };
    const next = formReducer(state, { type: "SUBMIT_SUCCESS" });
    expect(next.open).toBe(false);
    expect(next.description).toBe("");
    expect(next.submitting).toBe(false);
  });
});

describe("submitIfValid", () => {
  it("calls onSubmit with trimmed description and dispatches SUBMIT_SUCCESS", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const dispatch = vi.fn();
    await submitIfValid("  Build login  ", false, onSubmit, dispatch);
    expect(onSubmit).toHaveBeenCalledWith("Build login");
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_START" });
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_SUCCESS" });
  });

  it("does nothing when description is empty", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn();
    const dispatch = vi.fn();
    await submitIfValid("   ", false, onSubmit, dispatch);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("does nothing when already submitting", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn();
    const dispatch = vi.fn();
    await submitIfValid("valid", true, onSubmit, dispatch);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches SUBMIT_ERROR when onSubmit rejects", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn().mockRejectedValue(new Error("Server error"));
    const dispatch = vi.fn();
    await submitIfValid("valid", false, onSubmit, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_START" });
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_ERROR", error: "Server error" });
  });

  it("uses fallback message for non-Error rejections", async () => {
    const { submitIfValid } = await import("./useNewMissionForm");
    const onSubmit = vi.fn().mockRejectedValue("string error");
    const dispatch = vi.fn();
    await submitIfValid("valid", false, onSubmit, dispatch);
    expect(dispatch).toHaveBeenCalledWith({ type: "SUBMIT_ERROR", error: "Failed to create mission" });
  });
});
