import { describe, expect, it } from "vitest";
import {
  LITE_CAMPAIGN_OPERATION_ID_PATTERN,
  createLiteCampaignOperationId,
} from "@/components/lite/campaign-operation";

describe("Lite campaign operation IDs", () => {
  it("creates the server-approved campaign UUID shape", () => {
    const operationId = createLiteCampaignOperationId(
      () => "018f0f91-66ee-7c6c-8e2d-c9f53639bca4",
    );

    expect(operationId).toBe(
      "campaign_018f0f91-66ee-7c6c-8e2d-c9f53639bca4",
    );
    expect(LITE_CAMPAIGN_OPERATION_ID_PATTERN.test(operationId)).toBe(true);
  });

  it("fails closed when the UUID source returns an invalid value", () => {
    expect(() => createLiteCampaignOperationId(() => "short")).toThrow(
      "A secure campaign operation ID could not be created.",
    );
  });
});
