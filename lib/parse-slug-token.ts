/**
 * Format validator for the `/pickup/{segment}` URL segment.
 *
 * Historically this module split the segment into `{slug}-{token}` and
 * the storage layer looked them up separately. That broke when slugs
 * AND tokens both contain hyphens (e.g. `brick-internal-demo-brick-03`)
 * — there's no way to know how many hyphens belong to the slug vs the
 * token without consulting the database.
 *
 * Current shape: just verify the URL segment is plausibly an office
 * pickup URL — non-empty, lowercase, contains at least one hyphen,
 * only `[a-z0-9-]` characters. The actual `slug + '-' + pickupUrlToken`
 * lookup happens in `storage.findOfficeByPickupUrlSegment(segment)`,
 * which iterates offices and finds the row whose composite matches.
 */

const SEGMENT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

export function isValidSlugTokenSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  return SEGMENT_RE.test(segment);
}

/**
 * Back-compat alias. Returns the validated segment in `{slug, token}`
 * shape using the LEGACY split (last hyphen) for any caller that still
 * needs the parsed pieces. Prefer `isValidSlugTokenSegment` +
 * `findOfficeByPickupUrlSegment` for new code.
 *
 * @deprecated Use `isValidSlugTokenSegment` and look up via
 *   `findOfficeByPickupUrlSegment` instead. The split is wrong when
 *   tokens themselves contain hyphens.
 */
export interface ParsedSlugToken {
  slug: string;
  token: string;
}

export function parseSlugToken(segment: string): ParsedSlugToken | null {
  if (!isValidSlugTokenSegment(segment)) return null;
  const lastDash = segment.lastIndexOf("-");
  return {
    slug: segment.slice(0, lastDash),
    token: segment.slice(lastDash + 1),
  };
}
