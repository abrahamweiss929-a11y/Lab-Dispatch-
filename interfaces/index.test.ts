import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getServices, resetAllMocks } from "./index";
import { NotConfiguredError } from "@/lib/errors";
import { getSent as getSentSms } from "@/mocks/sms";

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
});
