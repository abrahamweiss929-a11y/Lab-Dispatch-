"use server";

import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import { getSupabaseAdminClient } from "@/interfaces/supabase-client";
import { evaluateAccess, isSafeNext, landingPathFor } from "@/lib/auth-rules";
import { setSession } from "@/lib/session";
import { isAllowedRole } from "@/lib/session-codec";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type { UserRole } from "@/lib/types";

export interface SignInFormState {
  error: string | null;
}

const GENERIC_INVALID = "Invalid email or password.";

function computeLandingPath(role: UserRole, next: string): string {
  if (!isSafeNext(next)) return landingPathFor(role);
  // Strip query string before evaluating; evaluateAccess only reads pathname.
  const pathname = next.split("?")[0] ?? "";
  const decision = evaluateAccess({ pathname, role });
  if (decision.action === "allow") return next;
  return landingPathFor(role);
}

function readUseMocks(): "mock" | "real" {
  const flag = process.env.USE_MOCKS;
  if (flag === undefined || flag === "true") return "mock";
  if (flag === "false") return "real";
  throw new Error(`USE_MOCKS must be 'true' or 'false', got: ${flag}`);
}

export async function signInAction(
  _prevState: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (email.length === 0 || password.length === 0) {
    return { error: "Please enter email and password." };
  }

  const mode = readUseMocks();

  if (mode === "mock") {
    let session;
    try {
      session = await getServices().auth.signIn({ email, password });
    } catch {
      return { error: GENERIC_INVALID };
    }
    await setSession(session.userId, session.role);
    const landing = computeLandingPath(session.role, next);
    redirect(landing);
  }

  // Real mode.
  const supabase = createSupabaseServerClient();
  const signInResult = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInResult.error || !signInResult.data?.user) {
    return { error: GENERIC_INVALID };
  }
  const userId = signInResult.data.user.id;

  // Profile lookup via the admin client so we don't depend on RLS
  // policies for reading own row. Failure here is indistinguishable to
  // the user from a bad password — we also call `signOut()` to clear
  // the cookies Supabase just wrote, since the user is not fully set up.
  const admin = getSupabaseAdminClient();
  const profileResult = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profileResult.error || !profileResult.data) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Best-effort; the user-facing error is the same regardless.
    }
    return { error: GENERIC_INVALID };
  }
  const rawRole = (profileResult.data as { role?: unknown }).role;
  if (!isAllowedRole(rawRole)) {
    try {
      await supabase.auth.signOut();
    } catch {
      // Best-effort.
    }
    return { error: GENERIC_INVALID };
  }

  await setSession(userId, rawRole);
  const landing = computeLandingPath(rawRole, next);
  redirect(landing);
}
