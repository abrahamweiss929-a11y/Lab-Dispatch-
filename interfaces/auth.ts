import { NotConfiguredError } from "@/lib/errors";
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

function notConfigured(): never {
  throw new NotConfiguredError({
    service: "auth (Supabase)",
    envVar: "NEXT_PUBLIC_SUPABASE_URL",
  });
}

export function createRealAuthService(): AuthService {
  return {
    async signIn() {
      notConfigured();
    },
    async signOut() {
      notConfigured();
    },
    async getCurrentUser() {
      notConfigured();
    },
  };
}
