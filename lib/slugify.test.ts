import { describe, expect, it } from "vitest";
import { ensureUniqueSlug, slugify } from "@/lib/slugify";

describe("slugify", () => {
  it("kebab-cases basic words", () => {
    expect(slugify("Acme Clinic")).toBe("acme-clinic");
  });

  it("collapses whitespace and trims dashes", () => {
    expect(slugify("  Foo   Bar  ")).toBe("foo-bar");
  });

  it("folds punctuation into dashes", () => {
    expect(slugify("O'Connor & Sons")).toBe("o-connor-sons");
  });

  it("strips accents via NFKD (keeps the base ASCII letter)", () => {
    // NFKD decomposes "é" into "e" + U+0301 combining acute accent;
    // we strip the combining marks but keep the base letter. This is the
    // behavior the plan's implementation description specifies.
    expect(slugify("café")).toBe("cafe");
  });

  it("throws on empty input", () => {
    expect(() => slugify("")).toThrow(/empty/);
  });

  it("throws on all-punctuation input", () => {
    expect(() => slugify("!!!")).toThrow(/empty/);
  });

  it("throws on emoji-only input", () => {
    expect(() => slugify("🙂")).toThrow(/empty/);
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base slug when not taken", async () => {
    const result = await ensureUniqueSlug("Acme Clinic", async () => false);
    expect(result).toBe("acme-clinic");
  });

  it("appends -2 when the base is taken", async () => {
    const taken = new Set(["acme-clinic"]);
    const result = await ensureUniqueSlug("Acme Clinic", async (slug) =>
      taken.has(slug),
    );
    expect(result).toBe("acme-clinic-2");
  });

  it("skips past taken suffixes to the first free one", async () => {
    const taken = new Set(["acme-clinic", "acme-clinic-2", "acme-clinic-3"]);
    const result = await ensureUniqueSlug("Acme Clinic", async (slug) =>
      taken.has(slug),
    );
    expect(result).toBe("acme-clinic-4");
  });

  it("throws when every candidate up to -99 is taken", async () => {
    await expect(
      ensureUniqueSlug("Acme Clinic", async () => true),
    ).rejects.toThrow(/exhausted/);
  });
});
