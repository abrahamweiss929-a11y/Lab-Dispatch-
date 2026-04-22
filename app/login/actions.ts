"use server";

import { redirect } from "next/navigation";
import { getServices } from "@/interfaces";
import { evaluateAccess, isSafeNext, landingPathFor } from "@/lib/auth-rules";
import { setSession } from "@/lib/session";
import type { UserRole } from "@/lib/types";

export interface SignInFormState {
  error: string | null;
}

function computeLandingPath(role: UserRole, next: string): string {
  if (!isSafeNext(next)) return landingPathFor(role);
  // Strip query string before evaluating; evaluateAccess only reads pathname.
  const pathname = next.split("?")[0];
  const decision = evaluateAccess({ pathname, role });
  if (decision.action === "allow") return next;
  return landingPathFor(role);
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

  let session;
  try {
    session = await getServices().auth.signIn({ email, password });
  } catch {
    return { error: "Invalid email or password." };
  }

  setSession(session.userId, session.role);
  const landing = computeLandingPath(session.role, next);
  redirect(landing);
}
