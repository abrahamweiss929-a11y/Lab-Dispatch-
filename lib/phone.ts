/**
 * Normalizes a US phone number to E.164 (`+1XXXXXXXXXX`).
 * - Strips every non-digit.
 * - Accepts 10 digits (assumes US country code) or 11 digits that start with `1`.
 * - Returns null on anything else (empty, too short, too long, non-1 country code).
 */
export function normalizeUsPhone(input: string): string | null {
  if (typeof input !== "string" || input.length === 0) return null;
  const digits = input.replace(/\D+/g, "");
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }
  return null;
}
