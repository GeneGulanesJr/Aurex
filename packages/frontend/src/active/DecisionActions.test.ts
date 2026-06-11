import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { EscalationTrigger } from "@aurex/shared";
import { DecisionActions } from "./DecisionActions";

describe("DecisionActions", () => {
  it("shows Continue Work, Rescope, Abort, and Add Guidance for validation_failed", () => {
    const trigger: EscalationTrigger = { kind: "validation_failed", milestoneId: "ms-1" };
    const html = renderToStaticMarkup(createElement(DecisionActions, {
      onDecision: () => {},
      trigger,
    }));

    expect(html).toContain("Continue Work");
    expect(html).toContain("Rescope");
    expect(html).toContain("Abort Mission");
    expect(html).toContain("Add Guidance");
  });

  it("shows Continue Work, Rescope, Abort, and Add Guidance for rescope_limit", () => {
    const trigger: EscalationTrigger = { kind: "rescope_limit", milestoneId: "ms-1" };
    const html = renderToStaticMarkup(createElement(DecisionActions, {
      onDecision: () => {},
      trigger,
    }));

    expect(html).toContain("Continue Work");
    expect(html).toContain("Rescope");
    expect(html).toContain("Abort Mission");
    expect(html).toContain("Add Guidance");
  });

  it("does NOT show Continue Work for unclassifiable_error (auto-retry of a runtime failure is unsafe)", () => {
    // The death-spiral guard fix: unclassifiable_error signals a runtime
    // /compliance failure (validator produced no verdict, integration
    // aborted, etc.). Silently re-running the milestone is unsafe — only
    // Rescope or Abort are valid recovery paths.
    const trigger: EscalationTrigger = { kind: "unclassifiable_error", milestoneId: "ms-1", error: "validator produced no verdict" };
    const html = renderToStaticMarkup(createElement(DecisionActions, {
      onDecision: () => {},
      trigger,
    }));

    expect(html).not.toContain("Continue Work");
    expect(html).toContain("Rescope");
    expect(html).toContain("Abort Mission");
    expect(html).toContain("Add Guidance");
  });

  it("shows Approve and Reject for milestone_complete", () => {
    const trigger: EscalationTrigger = { kind: "milestone_complete", milestoneId: "ms-1", releaseBranch: "release/ms-1" };
    const html = renderToStaticMarkup(createElement(DecisionActions, {
      onDecision: () => {},
      trigger,
    }));

    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).not.toContain("Continue Work");
    expect(html).not.toContain("Rescope");
  });

  it("shows Approve Over Budget and Abort for cost_cap_exceeded", () => {
    const trigger: EscalationTrigger = { kind: "cost_cap_exceeded", milestoneId: "ms-1" };
    const html = renderToStaticMarkup(createElement(DecisionActions, {
      onDecision: () => {},
      trigger,
    }));

    expect(html).toContain("Approve Over Budget");
    expect(html).toContain("Abort Mission");
  });

  it("shows Resume After Reset and Abort for quota_exhausted", () => {
    const trigger: EscalationTrigger = { kind: "quota_exhausted", milestoneId: "ms-1", windowResetsAt: "2026-01-01" };
    const html = renderToStaticMarkup(createElement(DecisionActions, {
      onDecision: () => {},
      trigger,
    }));

    expect(html).toContain("Resume After Reset");
    expect(html).toContain("Abort Mission");
  });
});
