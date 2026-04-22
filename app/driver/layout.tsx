import type { ReactNode, ReactElement } from "react";
import type { Viewport } from "next";

/**
 * `/driver/**` segment layout. The root `app/layout.tsx` already owns the
 * html/body shell; this layout just overrides the viewport so the mobile
 * UI respects the device width and safe-area insets (iOS notch).
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DriverSegmentLayout({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  return <>{children}</>;
}
