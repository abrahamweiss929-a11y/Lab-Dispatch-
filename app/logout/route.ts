import { NextResponse, type NextRequest } from "next/server";
import { getServices } from "@/interfaces";
import { clearSession } from "@/lib/session";

async function handler(request: NextRequest): Promise<NextResponse> {
  try {
    await getServices().auth.signOut();
  } finally {
    clearSession();
  }
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}

export const GET = handler;
export const POST = handler;
