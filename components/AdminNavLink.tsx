"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface AdminNavLinkProps {
  href: string;
  children: ReactNode;
}

/**
 * Sidebar nav link that highlights itself when the current pathname
 * matches or is nested under `href`. Exact match for `/admin` (the
 * dashboard root) so it doesn't light up on every admin page.
 */
export function AdminNavLink({ href, children }: AdminNavLinkProps) {
  const pathname = usePathname() ?? "";
  const active =
    href === "/admin"
      ? pathname === "/admin"
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
