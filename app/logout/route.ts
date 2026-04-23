import { NextResponse, type NextRequest } from "next/server";
import { getServices } from "@/interfaces";
import { clearSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase-server";

function readUseMocks(): "mock" | "real" {
  const flag = process.env.USE_MOCKS;
  if (flag === undefined || flag === "true") return "mock";
  if (flag === "false") return "real";
  throw new Error(`USE_MOCKS must be 'true' or 'false', got: ${flag}`);
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const mode = readUseMocks();
  if (mode === "mock") {
    try {
      await getServices().auth.signOut();
    } finally {
      await clearSession();
    }
  } else {
    // Real mode. Logout is best-effort — we always clear the companion
    // `ld_role` cookie and redirect, even if the Supabase signOut call
    // throws. Losing a session from the UI's POV is the load-bearing
    // invariant; leaving stale cookies on a server-side error would be
    // worse.
    try {
      const supabase = createSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // Intentionally swallowed.
    }
    await clearSession();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

export const GET = handler;
export const POST = handler;
