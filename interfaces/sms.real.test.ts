import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `vi.mock` is hoisted to the top of the file before `import` runs. The
// factory can only reference modules or `vi.hoisted` values — referencing
// outer file locals would hit the TDZ. We stash the mock reference on
// `vi.hoisted` so the factory closes over it safely and each test can
// swap in its own `messages.create` behavior without re-mocking.
const hoisted = vi.hoisted(() => {
  return {
    holder: {
      current: vi.fn() as ReturnType<typeof vi.fn>,
    },
    ctorSpy: vi.fn() as ReturnType<typeof vi.fn>,
  };
});

vi.mock("twilio", () => {
  // The SDK's default export is a factory function `twilio(sid, token)`
  // returning a client. We mirror that shape: the factory captures the
  // constructor args for later assertion and returns a client whose
  // `messages.create` is the test-controlled mock.
  const factory = (sid: string, token: string) => {
    hoisted.ctorSpy(sid, token);
    return { messages: { create: hoisted.holder.current } };
  };
  return { default: factory };
});

import type { SmsService } from "./sms";

const STUB_SID = "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
const STUB_TOKEN = "test-auth-token-abc123";
const STUB_FROM_RAW = "(415) 555-0100";
const STUB_FROM_E164 = "+14155550100";

interface ErrorSpy {
  mock: { calls: unknown[][] };
  mockRestore(): void;
  (...args: unknown[]): void;
}

/**
 * Flatten every argument passed to `errorSpy` into plain strings so we
 * can assert that sensitive strings (sid, token, body) do not appear in
 * any log output — including defensive sweeps against non-string args.
 */
function flattenErrorArgs(errorSpy: ErrorSpy): string[] {
  const out: string[] = [];
  for (const call of errorSpy.mock.calls) {
    for (const arg of call) {
      if (typeof arg === "string") {
        out.push(arg);
      } else if (arg instanceof Error) {
        out.push(arg.message);
      } else {
        try {
          out.push(JSON.stringify(arg));
        } catch {
          out.push(String(arg));
        }
      }
    }
  }
  return out;
}

describe("createRealSmsService() — hermetic coverage against mocked twilio", () => {
  let service: SmsService;
  let errorSpy: ErrorSpy;

  beforeEach(async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", STUB_SID);
    vi.stubEnv("TWILIO_AUTH_TOKEN", STUB_TOKEN);
    vi.stubEnv("TWILIO_FROM_NUMBER", STUB_FROM_RAW);
    // Fresh module graph so the mocked SDK binding is freshly resolved
    // inside `sms.real.ts` each test.
    vi.resetModules();
    hoisted.holder.current = vi.fn();
    hoisted.ctorSpy.mockReset();
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {}) as unknown as ErrorSpy;
    const mod = await import("./sms.real");
    service = mod.createRealSmsService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
  });

  it("returns { id, status: 'queued' } on happy path and passes normalized to/from/body to messages.create", async () => {
    hoisted.holder.current.mockResolvedValueOnce({ sid: "SM123abc" });
    const result = await service.sendSms({
      to: "(415) 555-0199",
      body: "hello",
    });
    expect(result).toEqual({ id: "SM123abc", status: "queued" });

    expect(hoisted.holder.current).toHaveBeenCalledTimes(1);
    const firstArg = hoisted.holder.current.mock.calls[0][0] as {
      to: string;
      from: string;
      body: string;
    };
    expect(firstArg).toEqual({
      to: "+14155550199",
      from: STUB_FROM_E164,
      body: "hello",
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("normalizes the TWILIO_FROM_NUMBER env var (not only the per-call `to`)", async () => {
    hoisted.holder.current.mockResolvedValueOnce({ sid: "SM456" });
    await service.sendSms({ to: "+15551234567", body: "hi" });
    const firstArg = hoisted.holder.current.mock.calls[0][0] as {
      from: string;
    };
    // `STUB_FROM_RAW = "(415) 555-0100"` → E.164 `+14155550100`. Proves
    // the env var is normalized once at client construction, not passed
    // raw to Twilio.
    expect(firstArg.from).toBe(STUB_FROM_E164);
  });

  it("throws Error on unparseable destination phone and does NOT call messages.create", async () => {
    await expect(
      service.sendSms({ to: "not a phone", body: "hi" }),
    ).rejects.toThrow(/invalid destination phone number/);
    expect(hoisted.holder.current).not.toHaveBeenCalled();
  });

  it("throws NotConfiguredError(envVar='TWILIO_ACCOUNT_SID') when SID is unset", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.resetModules();
    const mod = await import("./sms.real");
    const deferredService = mod.createRealSmsService();
    try {
      await deferredService.sendSms({ to: "+15551234567", body: "x" });
      throw new Error("expected sendSms to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("NotConfiguredError");
      expect((err as Error & { envVar?: string }).envVar).toBe(
        "TWILIO_ACCOUNT_SID",
      );
    }
    expect(hoisted.holder.current).not.toHaveBeenCalled();
  });

  it("throws NotConfiguredError(envVar='TWILIO_AUTH_TOKEN') when only the token is unset", async () => {
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    vi.resetModules();
    const mod = await import("./sms.real");
    const deferredService = mod.createRealSmsService();
    try {
      await deferredService.sendSms({ to: "+15551234567", body: "x" });
      throw new Error("expected sendSms to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("NotConfiguredError");
      expect((err as Error & { envVar?: string }).envVar).toBe(
        "TWILIO_AUTH_TOKEN",
      );
    }
  });

  it("throws NotConfiguredError(envVar='TWILIO_FROM_NUMBER') when only FROM is unset", async () => {
    vi.stubEnv("TWILIO_FROM_NUMBER", "");
    vi.resetModules();
    const mod = await import("./sms.real");
    const deferredService = mod.createRealSmsService();
    try {
      await deferredService.sendSms({ to: "+15551234567", body: "x" });
      throw new Error("expected sendSms to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("NotConfiguredError");
      expect((err as Error & { envVar?: string }).envVar).toBe(
        "TWILIO_FROM_NUMBER",
      );
    }
  });

  it("throws NotConfiguredError(envVar='TWILIO_FROM_NUMBER') when FROM is set but unparseable", async () => {
    vi.stubEnv("TWILIO_FROM_NUMBER", "not-a-phone");
    vi.resetModules();
    const mod = await import("./sms.real");
    const deferredService = mod.createRealSmsService();
    try {
      await deferredService.sendSms({ to: "+15551234567", body: "x" });
      throw new Error("expected sendSms to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("NotConfiguredError");
      expect((err as Error & { envVar?: string }).envVar).toBe(
        "TWILIO_FROM_NUMBER",
      );
    }
  });

  it("catches SDK throw, logs a fixed context string, rethrows generic Error", async () => {
    const SENSITIVE_BODY = "patient name + sample count 3";
    hoisted.holder.current.mockRejectedValueOnce(
      Object.assign(
        new Error(
          `RestException: auth failed, accountSid=${STUB_SID}, token=${STUB_TOKEN}, body=${SENSITIVE_BODY}`,
        ),
        { code: 20003 },
      ),
    );
    try {
      await service.sendSms({ to: "+15551234567", body: SENSITIVE_BODY });
      throw new Error("expected sendSms to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toMatch(/Twilio send failed/);
      // Rethrown error must not contain SID, token, body, or the SDK's
      // own message.
      expect((err as Error).message).not.toContain(STUB_SID);
      expect((err as Error).message).not.toContain(STUB_TOKEN);
      expect((err as Error).message).not.toContain(SENSITIVE_BODY);
      expect((err as Error).message).not.toContain("RestException");
    }
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it("no console.error argument contains accountSid, authToken, or message body (defense-in-depth regex sweep)", async () => {
    const SENSITIVE_BODY = "patient name + sample count 3";
    hoisted.holder.current.mockRejectedValueOnce(
      Object.assign(
        new Error(
          `RestException: auth failed, accountSid=${STUB_SID}, token=${STUB_TOKEN}, body=${SENSITIVE_BODY}`,
        ),
        { code: 20003 },
      ),
    );
    await expect(
      service.sendSms({ to: "+15551234567", body: SENSITIVE_BODY }),
    ).rejects.toThrow();

    const flat = flattenErrorArgs(errorSpy);
    expect(flat.length).toBeGreaterThan(0);
    for (const s of flat) {
      expect(s).not.toMatch(/ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/);
      expect(s).not.toMatch(/test-auth-token-abc123/);
      expect(s).not.toMatch(/patient name \+ sample count 3/);
    }
  });

  it("client is constructed with the correct (sid, token) and cached across calls", async () => {
    hoisted.holder.current.mockResolvedValueOnce({ sid: "SM1" });
    hoisted.holder.current.mockResolvedValueOnce({ sid: "SM2" });
    await service.sendSms({ to: "+15551234567", body: "one" });
    await service.sendSms({ to: "+15551234568", body: "two" });
    expect(hoisted.ctorSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.ctorSpy).toHaveBeenCalledWith(STUB_SID, STUB_TOKEN);
  });

  it("does not call messages.create when NotConfiguredError fires", async () => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    vi.resetModules();
    const mod = await import("./sms.real");
    const deferredService = mod.createRealSmsService();
    await expect(
      deferredService.sendSms({ to: "+15551234567", body: "x" }),
    ).rejects.toThrow();
    expect(hoisted.holder.current).not.toHaveBeenCalled();
  });
});
