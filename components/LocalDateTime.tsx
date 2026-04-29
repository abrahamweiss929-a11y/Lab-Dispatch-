"use client";

import { useEffect, useState } from "react";

export type LocalDateTimeStyle = "short" | "relative";

interface LocalDateTimeProps {
  /** ISO 8601 timestamp. */
  iso: string;
  /**
   * "short" → "Apr 28, 10:22 PM" in the user's locale.
   * "relative" → "12 minutes ago" for items < 24h old, falling back
   *   to "short" for older items. Useful for inbox-like views.
   * Default: "short".
   */
  style?: LocalDateTimeStyle;
  /** Wraps the rendered text. Defaults to <time>. */
  className?: string;
}

const SHORT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
};

function formatShort(date: Date): string {
  return new Intl.DateTimeFormat(undefined, SHORT_OPTIONS).format(date);
}

function formatRelative(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const ageHours = diffMs / 3_600_000;

  if (ageHours < 0) {
    // Future timestamp — fall back to short form.
    return formatShort(date);
  }
  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) {
    const mins = Math.round(diffMs / 60_000);
    return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  }
  if (ageHours < 24) {
    const hours = Math.round(ageHours);
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  return formatShort(date);
}

/**
 * Renders an ISO timestamp in the user's LOCAL timezone, client-side.
 *
 * SSR renders an empty `<time>` (with the ISO in `dateTime` and
 * `title`) to avoid hydration mismatch from server/client timezone
 * differences. After mount, useEffect fills in the formatted string
 * using `Intl.DateTimeFormat()` with no timezone arg → uses the
 * browser's local zone. The element's title attribute always carries
 * the full ISO for hover-to-disambiguate.
 */
export function LocalDateTime({
  iso,
  style = "short",
  className,
}: LocalDateTimeProps) {
  const [text, setText] = useState<string>("");

  useEffect(() => {
    if (!iso) return;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      setText("—");
      return;
    }
    if (style === "relative") {
      setText(formatRelative(date, new Date()));
      // Refresh once a minute so "5 minutes ago" stays current.
      const interval = setInterval(() => {
        setText(formatRelative(new Date(iso), new Date()));
      }, 60_000);
      return () => clearInterval(interval);
    }
    setText(formatShort(date));
  }, [iso, style]);

  return (
    <time
      dateTime={iso}
      title={iso}
      className={className}
      suppressHydrationWarning
    >
      {text}
    </time>
  );
}
