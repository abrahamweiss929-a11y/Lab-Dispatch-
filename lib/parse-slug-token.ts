/**
 * Pure parser for the `/pickup/{slug}-{token}` URL segment.
 *
 * The slug half may itself contain hyphens (slugify produces kebab-case),
 * so we split on the LAST `-` rather than the first.
 *
 * The token shape — `/^[a-z0-9]{12}$/` — mirrors what `makeRandomId(12)`
 * emits when offices are created in the admin form. Any shape failure
 * returns `null` so callers can respond with a 404.
 */

export interface ParsedSlugToken {
  slug: string;
  token: string;
}

const TOKEN_RE = /^[a-z0-9]{12}$/;
const SLUG_RE = /^[a-z0-9-]+$/;

export function parseSlugToken(slugToken: string): ParsedSlugToken | null {
  if (slugToken.length === 0) return null;
  const lastDash = slugToken.lastIndexOf("-");
  if (lastDash <= 0) return null;
  const slug = slugToken.slice(0, lastDash);
  const token = slugToken.slice(lastDash + 1);
  if (!TOKEN_RE.test(token)) return null;
  if (!SLUG_RE.test(slug)) return null;
  return { slug, token };
}
