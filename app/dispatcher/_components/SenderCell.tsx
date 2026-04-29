import type { SenderDisplay } from "@/lib/sender-display";

interface SenderCellProps {
  display: SenderDisplay;
  /** Compact = single line, useful for very dense lists. Default false. */
  compact?: boolean;
}

/**
 * Renders a sender column cell. Shows doctor name (if matched at the
 * doctor level), office name, and address on three lines for matched
 * senders. For unknown senders shows "Unknown sender" with the raw
 * identifier in muted small text below.
 */
export function SenderCell({ display, compact = false }: SenderCellProps) {
  if (display.kind === "unknown") {
    return (
      <div className={compact ? "" : "leading-snug"}>
        <p className="font-semibold text-gray-700">Unknown sender</p>
        <p className="text-xs text-gray-400 break-all">{display.raw}</p>
      </div>
    );
  }

  const { doctorName, officeName, address } = display;
  const addressLine = `${address.street}, ${address.city}, ${address.state} ${address.zip}`;
  return (
    <div className={compact ? "" : "leading-snug"}>
      {doctorName ? (
        <p className="font-semibold text-gray-900">{doctorName}</p>
      ) : null}
      <p
        className={
          doctorName
            ? "text-sm text-gray-700"
            : "font-semibold text-gray-900"
        }
      >
        {officeName}
      </p>
      <p className="text-xs text-gray-500">{addressLine}</p>
    </div>
  );
}
