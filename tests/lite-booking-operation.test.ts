import { describe, expect, it } from "vitest";
import {
  LITE_BOOKING_OPERATION_ID_PATTERN,
  createLiteBookingOperationId,
} from "@/components/lite/booking-operation";

describe("Lite booking operation IDs", () => {
  it("creates the server-approved booking UUID shape", () => {
    const operationId = createLiteBookingOperationId(
      () => "018f0f91-66ee-7c6c-8e2d-c9f53639bca4",
    );

    expect(operationId).toBe(
      "booking_018f0f91-66ee-7c6c-8e2d-c9f53639bca4",
    );
    expect(LITE_BOOKING_OPERATION_ID_PATTERN.test(operationId)).toBe(true);
  });

  it("fails closed when the UUID source returns an invalid value", () => {
    expect(() => createLiteBookingOperationId(() => "short")).toThrow(
      "A secure booking operation ID could not be created.",
    );
  });
});
