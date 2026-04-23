import "@testing-library/jest-dom/vitest";
import { beforeEach, vi } from "vitest";
import { resetAllMocks } from "@/interfaces";

// The `server-only` package throws at import-time when it detects a
// non-server environment. Vitest runs under Node, but the package's
// environment heuristics still trip under jsdom in some harnesses, so we
// stub it out globally. Production/Next.js still gets the real
// `server-only` guard from the installed package — this shim only affects
// Vitest's module registry.
vi.mock("server-only", () => ({}));

beforeEach(() => {
  resetAllMocks();
});
