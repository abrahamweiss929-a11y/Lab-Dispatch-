/**
 * Pure URL-slug helpers.
 *
 * `slugify` returns ASCII-only kebab-case. It strips combining accents via
 * NFKD normalization, collapses runs of non-[a-z0-9] into single dashes,
 * trims leading/trailing dashes, and throws if the result is empty.
 *
 * `ensureUniqueSlug` probes a caller-supplied `isTaken` function and
 * appends numeric suffixes (`-2` through `-99`) until it finds a free slot
 * or exhausts the range.
 */

const MAX_COLLISION_SUFFIX = 99;

export function slugify(input: string): string {
  if (input.length === 0) {
    throw new Error("slugify: input is empty");
  }

  const stripped = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const slug = stripped.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new Error("slugify: input is empty");
  }

  return slug;
}

export async function ensureUniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const root = slugify(base);
  if (!(await isTaken(root))) {
    return root;
  }
  for (let suffix = 2; suffix <= MAX_COLLISION_SUFFIX; suffix += 1) {
    const candidate = `${root}-${suffix}`;
    if (!(await isTaken(candidate))) {
      return candidate;
    }
  }
  throw new Error("ensureUniqueSlug: exhausted");
}
