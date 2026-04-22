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
    "block rounded px-3 py-2 text-sm",
    active
      ? "bg-gray-900 font-medium text-white"
      : "text-gray-700 hover:bg-gray-100",
  ].join(" ");

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
