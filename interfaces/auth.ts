import type { UserRole } from "@/lib/types";

export interface SignInParams {
  email: string;
  password: string;
}

export interface Session {
  userId: string;
  role: UserRole;
}

export interface AuthService {
  signIn(params: SignInParams): Promise<Session>;
  signOut(): Promise<void>;
  getCurrentUser(): Promise<Session | null>;
}

// The real adapter lives in a `"server-only"` module so webpack errors
// if anyone accidentally pulls it into a Client Component. Callers
// continue to import the interface + helper types from this file.
export { createRealAuthService } from "./auth.real";
