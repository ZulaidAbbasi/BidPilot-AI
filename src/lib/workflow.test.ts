import { describe, it, expect } from "vitest";
import {
  WORKFLOW_STATUSES,
  isWorkflowStatus,
  nextAction,
  statusTone,
  workflowLabel,
  workflowStageIndex,
} from "@/lib/workflow";

describe("workflow", () => {
  it("has the 14 canonical states", () => {
    expect(WORKFLOW_STATUSES).toHaveLength(14);
    expect(WORKFLOW_STATUSES).toContain("DRAFT");
    expect(WORKFLOW_STATUSES).toContain("FAILED");
    expect(WORKFLOW_STATUSES).toContain("REPORT_READY");
  });

  it("guards unknown states", () => {
    expect(isWorkflowStatus("DRAFT")).toBe(true);
    expect(isWorkflowStatus("BOGUS")).toBe(false);
  });

  it("returns stable stage index for known states", () => {
    expect(workflowStageIndex("DRAFT")).toBe(0);
    expect(workflowStageIndex("REPORT_READY")).toBeGreaterThan(0);
    expect(workflowStageIndex("UNKNOWN")).toBe(0);
  });

  it("labels every state", () => {
    for (const s of WORKFLOW_STATUSES) {
      expect(workflowLabel(s)).toBeTruthy();
    }
  });

  it("assigns tones sanely", () => {
    expect(statusTone("REPORT_READY")).toBe("verified");
    expect(statusTone("FAILED")).toBe("risk");
    expect(statusTone("DRAFT")).toBe("warn");
  });

  it("suggests report action when complete", () => {
    expect(nextAction("REPORT_READY", true, 3).to).toBe("report");
    expect(nextAction("SPEC_CONFIRMED", true, 0).to).toBe("providers");
    expect(nextAction("INTAKE_IN_PROGRESS", true, 0).to).toBe("intake");
  });
});
