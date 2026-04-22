import { NextResponse, type NextRequest } from "next/server";
import { evaluateAccess } from "@/lib/auth-rules";
import { decodeSession, SESSION_COOKIE } from "@/lib/session";

export function middleware(request: NextRequest): NextResponse {
  const raw = request.cookies.get(SESSION_COOKIE)?.value;
  const session = decodeSession(raw);
  const role = session?.role ?? null;

  const decision = evaluateAccess({
    pathname: request.nextUrl.pathname,
    role,
  });

  if (decision.action === "allow") {
    return NextResponse.next();
  }
  return NextResponse.redirect(new URL(decision.to, request.url));
}

export const config = {
  matcher: [
    // Run on everything except Next internals and obvious static files.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|gif|webp|ico|txt|xml)).*)",
  ],
};
