import { describe, expect, it } from "vitest";

import { safeFlowRenderers } from "@/components/templates/template-studio-data";

describe("inert local WhatsApp Flow render contracts", () => {
  it("covers the six persisted PRD journeys without catalogue or provider fixtures", () => {
    expect(safeFlowRenderers.map((flow) => flow.assetKey)).toEqual([
      "doctor_booking_flow",
      "home_collection_flow",
      "appointment_change_flow",
      "package_enquiry_flow",
      "service_feedback_flow",
      "communication_preferences_flow",
    ]);
    expect(safeFlowRenderers.map((flow) => flow.definitionId)).toEqual([
      "synthetic-flow-appointment-request",
      "synthetic-flow-laboratory-collection-request",
      "synthetic-flow-appointment-change",
      "synthetic-flow-package-enquiry",
      "synthetic-flow-feedback",
      "synthetic-flow-communication-preferences",
    ]);

    for (const flow of safeFlowRenderers) {
      expect(flow.version).toBe(1);
      expect(flow.flowScreens.length).toBeGreaterThanOrEqual(7);
      expect(new Set(flow.flowScreens.map((screen) => screen.id)).size).toBe(
        flow.flowScreens.length,
      );
      expect(flow.flowScreens.at(-1)?.terminal).toBe(true);
      expect(flow.fallback.length).toBeGreaterThan(20);
      expect(flow).not.toHaveProperty("providerState");
      expect(flow).not.toHaveProperty("providerId");
      expect(flow).not.toHaveProperty("language");
      expect(flow).not.toHaveProperty("localState");
    }
  });

  it("keeps sensitive handoffs, pending outcomes and marketing defaults explicit", () => {
    const packageFlow = safeFlowRenderers.find(
      (flow) => flow.assetKey === "package_enquiry_flow",
    );
    const preferenceFlow = safeFlowRenderers.find(
      (flow) => flow.assetKey === "communication_preferences_flow",
    );
    const labFlow = safeFlowRenderers.find(
      (flow) => flow.assetKey === "home_collection_flow",
    );
    const appointmentFlow = safeFlowRenderers.find(
      (flow) => flow.assetKey === "doctor_booking_flow",
    );

    expect(
      packageFlow?.flowScreens.some((screen) =>
        screen.description.includes("No payment data"),
      ),
    ).toBe(true);
    expect(
      preferenceFlow?.flowScreens.some((screen) =>
        screen.description.includes("unselected by default"),
      ),
    ).toBe(true);
    expect(
      labFlow?.flowScreens.some((screen) =>
        screen.description.includes("reports, diagnoses, payment-card details"),
      ),
    ).toBe(true);
    expect(appointmentFlow?.flowScreens.at(-1)?.title).toContain(
      "Pending authoritative",
    );
  });
});
