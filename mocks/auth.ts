import type {
  AuthService,
  Session,
  SignInParams,
} from "@/interfaces/auth";

// Mock-only shared password. DO NOT use in real adapters.
const MOCK_PASSWORD = "test1234";

// Seeded accounts keyed by lowercased email.
//
// As of the 2026-04-27 unification, admin@test and dispatcher@test both
// resolve to role 'office' — same as what the production migration does
// to existing profile rows. The legacy emails are kept so any operator
// muscle-memory or smoke test that signs in as `admin@test` or
// `dispatcher@test` still works.
const SEEDED_ACCOUNTS: Record<string, Session> = {
  "driver@test": { userId: "user-driver", role: "driver" },
  "dispatcher@test": { userId: "user-dispatcher", role: "office" },
  "admin@test": { userId: "user-admin", role: "office" },
};

interface AuthMockState {
  currentSession: Session | null;
}

const state: AuthMockState = {
  currentSession: null,
};

export const authMock: AuthService = {
  async signIn(params: SignInParams): Promise<Session> {
    const key = params.email.toLowerCase();
    const account = SEEDED_ACCOUNTS[key];
    if (!account || params.password !== MOCK_PASSWORD) {
      throw new Error("invalid credentials");
    }
    state.currentSession = account;
    return account;
  },

  async signOut(): Promise<void> {
    state.currentSession = null;
  },

  async getCurrentUser(): Promise<Session | null> {
    return state.currentSession;
  },
};

export function resetAuthMock(): void {
  state.currentSession = null;
}
