import { describe, it, expect } from "vitest";
import { NotConfiguredError } from "./errors";

describe("NotConfiguredError", () => {
  it("has the fixed name 'NotConfiguredError'", () => {
    const err = new NotConfiguredError({
      service: "sms (Twilio)",
      envVar: "TWILIO_ACCOUNT_SID",
    });
    expect(err.name).toBe("NotConfiguredError");
  });

  it("formats the message with service and envVar", () => {
    const err = new NotConfiguredError({
      service: "sms (Twilio)",
      envVar: "TWILIO_ACCOUNT_SID",
    });
    expect(err.message).toBe(
      "sms (Twilio) is not configured — see BLOCKERS.md and set TWILIO_ACCOUNT_SID",
    );
  });

  it("exposes service and envVar as readonly properties", () => {
    const err = new NotConfiguredError({
      service: "storage (Supabase)",
      envVar: "NEXT_PUBLIC_SUPABASE_URL",
    });
    expect(err.service).toBe("storage (Supabase)");
    expect(err.envVar).toBe("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("is an instance of Error and NotConfiguredError", () => {
    const err = new NotConfiguredError({
      service: "email (Postmark)",
      envVar: "POSTMARK_SERVER_TOKEN",
    });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(NotConfiguredError);
  });
});
