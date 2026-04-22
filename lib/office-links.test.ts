import { describe, expect, it } from "vitest";
import { googleMapsSearchUrl } from "@/lib/office-links";

describe("googleMapsSearchUrl", () => {
  it("URL-encodes a full address with commas and spaces", () => {
    const url = googleMapsSearchUrl({
      street: "100 Main St",
      city: "Princeton",
      state: "NJ",
      zip: "08540",
    });
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("100 Main St, Princeton, NJ, 08540"),
    );
  });

  it("omits missing fields (empty zip)", () => {
    const url = googleMapsSearchUrl({
      street: "100 Main St",
      city: "Princeton",
      state: "NJ",
      zip: "",
    });
    expect(url).toBe(
      "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent("100 Main St, Princeton, NJ"),
    );
  });

  it("returns base URL with empty query when every field is empty", () => {
    const url = googleMapsSearchUrl({
      street: "",
      city: "",
      state: "",
      zip: "",
    });
    expect(url).toBe("https://www.google.com/maps/search/?api=1&query=");
  });
});
