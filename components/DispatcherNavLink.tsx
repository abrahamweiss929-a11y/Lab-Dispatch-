"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface DispatcherNavLinkProps {
  href: string;
  children: ReactNode;
}

/**
 * Sidebar nav link for the dispatcher chrome. Highlights itself when the
 * current pathname matches or is nested under `href`. Exact match for
 * `/dispatcher` (the dashboard root) so it doesn't light up on every
 * dispatcher page.
 */
export function DispatcherNavLink({ href, children }: DispatcherNavLinkProps) {
  const pathname = usePathname() ?? "";
  const active =
    href === "/dispatcher"
      ? pathname === "/dispatcher"
      : pathname === href || pathname.startsWith(`${href}/`);

  const className = [
    "app-nav-link",
    active ? "app-nav-link-active" : "",
  ].join(" ");

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
