import { describe, it, expect } from "vitest";
import { estimateEtaText } from "./eta";

describe("estimateEtaText", () => {
  it("returns the v1 placeholder string verbatim", () => {
    // Pinned literal — downstream swap (e.g., Mapbox-backed ETA) must
    // update this assertion deliberately.
    expect(estimateEtaText()).toBe("within about 2 hours");
  });
});
