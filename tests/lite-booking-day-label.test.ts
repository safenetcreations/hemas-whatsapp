import { describe, expect, it } from "vitest";
import { formatLiteBookingDay } from "@/components/lite/lite-ui";

describe("formatLiteBookingDay", () => {
  it("renders a canonical ISO day id as a readable weekday label", () => {
    expect(formatLiteBookingDay("day_2026-08-13")).toMatch(/^Thursday,? 13 Aug$/);
    expect(formatLiteBookingDay("2026-08-13")).toMatch(/^Thursday,? 13 Aug$/);
  });

  it("never renders 'Invalid Date' for legacy or malformed day ids", () => {
    for (const legacy of ["day_mon", "day_1", "day_", "", "day_2026-13-45", "day_tomorrow"]) {
      const label = formatLiteBookingDay(legacy);
      expect(label).toBe("Date to be confirmed");
      expect(label).not.toContain("Invalid");
    }
  });
});
