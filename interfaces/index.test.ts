import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getServices, resetAllMocks } from "./index";
import { NotConfiguredError } from "@/lib/errors";
import { getSent as getSentSms } from "@/mocks/sms";
import { storageMock } from "@/mocks/storage";
import { resetSeedFlag } from "@/mocks/seed";

describe("getServices()", () => {
  beforeEach(() => {
    resetAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns mock services when USE_MOCKS is unset", async () => {
    vi.stubEnv("USE_MOCKS", "");
    // stubEnv with "" sets it; re-unset to truly unset for this case.
    vi.unstubAllEnvs();
    const services = getServices();
    const result = await services.sms.sendSms({
      to: "+15551234567",
      body: "hello",
    });
    expect(result.status).toBe("queued");
    expect(getSentSms()).toHaveLength(1);
  });

  it("returns mock services when USE_MOCKS is 'true'", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    const services = getServices();
    await services.sms.sendSms({ to: "+15551234567", body: "hello" });
    expect(getSentSms()).toHaveLength(1);
  });

  it("returns real stubs that throw NotConfiguredError when USE_MOCKS is 'false'", async () => {
    vi.stubEnv("USE_MOCKS", "false");
    const services = getServices();
    try {
      await services.sms.sendSms({ to: "+15551234567", body: "hi" });
      throw new Error("expected NotConfiguredError");
    } catch (err) {
      expect(err).toBeInstanceOf(NotConfiguredError);
      expect((err as NotConfiguredError).envVar).toBe("TWILIO_ACCOUNT_SID");
    }
  });

  it("real storage throws NotConfiguredError with envVar='NEXT_PUBLIC_SUPABASE_URL' when USE_MOCKS='false' and Supabase env is missing", async () => {
    vi.stubEnv("USE_MOCKS", "false");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    // Clear the memoized admin client so the missing-env branch runs.
    const { __resetSupabaseAdminClient } = await import(
      "./supabase-client"
    );
    __resetSupabaseAdminClient();
    const services = getServices();
    try {
      await services.storage.listOffices();
      throw new Error("expected NotConfiguredError");
    } catch (err) {
      expect(err).toBeInstanceOf(NotConfiguredError);
      expect((err as NotConfiguredError).envVar).toBe(
        "NEXT_PUBLIC_SUPABASE_URL",
      );
    }
  });

  it("throws when USE_MOCKS is set to an invalid value", () => {
    vi.stubEnv("USE_MOCKS", "yes");
    expect(() => getServices()).toThrow(/USE_MOCKS must be 'true' or 'false'/);
  });

  it("resetAllMocks() clears mock state across services", async () => {
    vi.stubEnv("USE_MOCKS", "true");
    const services = getServices();
    await services.sms.sendSms({ to: "+15551234567", body: "one" });
    expect(getSentSms()).toHaveLength(1);
    resetAllMocks();
    expect(getSentSms()).toHaveLength(0);
  });

  describe("auto-seed hook", () => {
    beforeEach(() => {
      resetAllMocks();
      resetSeedFlag();
    });

    it("does not auto-seed under NODE_ENV=test", async () => {
      // Vitest already sets NODE_ENV=test; make it explicit so the
      // intent reads clearly. No stub needed for the negative case,
      // but we assert current state and the post-getServices state.
      expect(process.env.NODE_ENV).toBe("test");
      getServices();
      expect(await storageMock.listOffices()).toHaveLength(0);
      expect(await storageMock.listPickupRequests()).toHaveLength(0);
    });

    it("auto-seeds under NODE_ENV=development", async () => {
      vi.stubEnv("NODE_ENV", "development");
      getServices();
      expect(await storageMock.listOffices()).toHaveLength(6);
      expect(await storageMock.listPickupRequests()).toHaveLength(20);
    });

    it("skips seeding when SEED_MOCKS=false even in development", async () => {
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("SEED_MOCKS", "false");
      getServices();
      expect(await storageMock.listOffices()).toHaveLength(0);
    });

    it("resetAllMocks() clears the seed flag so the next getServices() re-seeds", async () => {
      vi.stubEnv("NODE_ENV", "development");
      getServices();
      expect(await storageMock.listOffices()).toHaveLength(6);
      resetAllMocks();
      expect(await storageMock.listOffices()).toHaveLength(0);
      getServices();
      expect(await storageMock.listOffices()).toHaveLength(6);
    });
  });
});
