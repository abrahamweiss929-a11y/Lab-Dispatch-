const MIN_SIZE = 1;
const MAX_SIZE = 32;

function assertSize(size: number): void {
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) {
    throw new RangeError(
      `size must be an integer between ${MIN_SIZE} and ${MAX_SIZE}, got ${size}`,
    );
  }
}

function normalizeSlug(slug: string): string {
  return slug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function makeRandomId(size = 8): string {
  assertSize(size);
  // Draw enough bytes to produce at least `size` base36 characters.
  // Each byte contributes roughly log36(256) ≈ 1.55 base36 chars; use size bytes
  // and concatenate per-byte base36 to guarantee we have enough material.
  const bytes = new Uint8Array(size);
  globalThis.crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i += 1) {
    out += bytes[i].toString(36).padStart(2, "0");
  }
  return out.slice(0, size);
}

export function makeSlugId(slug: string, size = 8): string {
  const normalized = normalizeSlug(slug);
  if (normalized.length === 0) {
    throw new Error("makeSlugId: slug normalizes to empty string");
  }
  return `${normalized}-${makeRandomId(size)}`;
}
