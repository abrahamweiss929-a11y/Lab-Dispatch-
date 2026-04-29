import { normalizeUsPhone } from "@/lib/phone";
import type { Doctor, Office, OfficeAddress } from "@/lib/types";

/**
 * Match an inbound `fromIdentifier` (email or phone) against the
 * known offices/doctors lists and return a structured display value.
 *
 * The `fromIdentifier` is whatever the inbound pipeline canonicalized
 * — lowercased email, or normalized E.164 phone. We re-canonicalize
 * here to be defensive.
 */

export interface SenderDisplayMatch {
  kind: "match";
  /** Doctor name, when matched at the doctor level. */
  doctorName?: string;
  /** Office name. Always present when matched. */
  officeName: string;
  /** Office address. Always present when matched. */
  address: OfficeAddress;
}

export interface SenderDisplayUnknown {
  kind: "unknown";
  /** Raw identifier, untouched. */
  raw: string;
}

export type SenderDisplay = SenderDisplayMatch | SenderDisplayUnknown;

function isLikelyEmail(s: string): boolean {
  return s.includes("@");
}

function canonicalizeIdentifier(raw: string): string {
  const trimmed = raw.trim();
  if (isLikelyEmail(trimmed)) return trimmed.toLowerCase();
  const phone = normalizeUsPhone(trimmed);
  return phone ?? trimmed;
}

/**
 * Resolve a sender. Doctors are checked first (more specific) so that
 * a known doctor inside a known office surfaces both names. Falls back
 * to office, then to "unknown".
 */
export function resolveSenderDisplay(
  fromIdentifier: string,
  offices: readonly Office[],
  doctors: readonly Doctor[],
): SenderDisplay {
  const canonical = canonicalizeIdentifier(fromIdentifier);
  const isEmail = isLikelyEmail(canonical);

  // Doctor match — check email or phone, depending on identifier shape.
  for (const doc of doctors) {
    const candidate = isEmail ? doc.email : doc.phone;
    if (candidate === undefined) continue;
    const docCanonical = canonicalizeIdentifier(candidate);
    if (docCanonical === canonical) {
      const office = offices.find((o) => o.id === doc.officeId);
      if (office) {
        return {
          kind: "match",
          doctorName: doc.name,
          officeName: office.name,
          address: office.address,
        };
      }
    }
  }

  // Office match.
  for (const office of offices) {
    const candidate = isEmail ? office.email : office.phone;
    if (candidate === undefined) continue;
    const officeCanonical = canonicalizeIdentifier(candidate);
    if (officeCanonical === canonical) {
      return {
        kind: "match",
        officeName: office.name,
        address: office.address,
      };
    }
  }

  return { kind: "unknown", raw: fromIdentifier };
}

/** Compact one-line representation, useful for table cells. */
export function formatSenderInline(display: SenderDisplay): string {
  if (display.kind === "unknown") return "Unknown sender";
  if (display.doctorName) return `${display.doctorName} · ${display.officeName}`;
  return display.officeName;
}

/** Multi-line description for dense rows. Returns plain strings. */
export function senderDisplayLines(display: SenderDisplay): string[] {
  if (display.kind === "unknown") {
    return ["Unknown sender", display.raw];
  }
  const lines: string[] = [];
  if (display.doctorName) lines.push(display.doctorName);
  lines.push(display.officeName);
  const a = display.address;
  lines.push(`${a.street}, ${a.city}, ${a.state} ${a.zip}`);
  return lines;
}
