import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appBaseUrl,
  buildDriverArrived,
  buildInviteEmail,
  buildPickupConfirmation,
  buildSamplesPickedUp,
  buildWelcomeEmail,
} from "./email-templates";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL };
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("appBaseUrl", () => {
  it("returns the production fallback when env is unset", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(appBaseUrl()).toBe("https://labdispatch.app");
  });

  it("uses NEXT_PUBLIC_APP_URL when set", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.labdispatch.app";
    expect(appBaseUrl()).toBe("https://staging.labdispatch.app");
  });

  it("strips trailing slashes", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.labdispatch.app/";
    expect(appBaseUrl()).toBe("https://staging.labdispatch.app");
  });
});

describe("buildInviteEmail", () => {
  it("renders an absolute /invite URL with the token", () => {
    const out = buildInviteEmail({
      role: "office",
      token: "tok-abc",
      expiresAt: "2026-05-03T00:00:00Z",
      invitedByName: "Admin Adams",
    });
    expect(out.subject).toBe("You've been invited to Lab Dispatch");
    expect(out.textBody).toContain("https://labdispatch.app/invite/tok-abc");
    expect(out.textBody).toContain("Admin Adams");
    expect(out.textBody).toContain("office staff");
    expect(out.htmlBody).toContain(
      'href="https://labdispatch.app/invite/tok-abc"',
    );
    expect(out.htmlBody).toContain("Set up your account");
  });

  it("uses 'driver' role label and falls back to generic invitedBy", () => {
    const out = buildInviteEmail({
      role: "driver",
      token: "tok",
      expiresAt: "2026-05-03T00:00:00Z",
    });
    expect(out.textBody).toContain("driver");
    expect(out.textBody).toContain("Your Lab Dispatch admin");
  });
});

describe("buildWelcomeEmail", () => {
  it("driver welcome links to /driver and includes name", () => {
    const out = buildWelcomeEmail({ fullName: "Pat Driver", role: "driver" });
    expect(out.subject).toBe("Welcome to Lab Dispatch");
    expect(out.textBody).toContain("Pat Driver");
    expect(out.textBody).toContain("https://labdispatch.app/driver");
    expect(out.htmlBody).toContain('href="https://labdispatch.app/driver"');
  });

  it("office welcome links to /dispatcher (shared tree)", () => {
    const out = buildWelcomeEmail({ role: "office" });
    expect(out.textBody).toContain("https://labdispatch.app/dispatcher");
  });

  it("admin welcome links to /admin", () => {
    const out = buildWelcomeEmail({ role: "admin" });
    expect(out.textBody).toContain("https://labdispatch.app/admin");
  });

  it("falls back to generic greeting when fullName missing", () => {
    const out = buildWelcomeEmail({ role: "office" });
    expect(out.textBody).toContain("Welcome to Lab Dispatch");
  });
});

describe("buildPickupConfirmation", () => {
  it("includes office name, ETA, and optional sample count + notes", () => {
    const out = buildPickupConfirmation({
      officeName: "Acme Clinic",
      etaText: "around 3:00 pm",
      notes: "ring bell at side door",
      sampleCount: 4,
    });
    expect(out.subject).toBe("Pickup request received — Lab Dispatch");
    expect(out.textBody).toContain("Acme Clinic");
    expect(out.textBody).toContain("around 3:00 pm");
    expect(out.textBody).toContain("4");
    expect(out.textBody).toContain("ring bell at side door");
    expect(out.htmlBody).toContain("Acme Clinic");
  });

  it("omits sample count and notes when missing or blank", () => {
    const out = buildPickupConfirmation({
      officeName: "Solo Clinic",
      etaText: "2 hours",
      notes: "   ",
    });
    expect(out.textBody).not.toContain("Sample count");
    expect(out.textBody).not.toContain("Notes:");
  });
});

describe("buildDriverArrived", () => {
  it("subject + body name the office and driver", () => {
    const out = buildDriverArrived({
      officeName: "Acme Clinic",
      driverName: "Pat Driver",
      arrivedAt: "Tue 3:14 pm",
    });
    expect(out.subject).toBe("Driver has arrived at Acme Clinic");
    expect(out.textBody).toContain("Pat Driver");
    expect(out.textBody).toContain("Tue 3:14 pm");
    expect(out.textBody).toMatch(/samples will be picked up shortly/i);
  });

  it("falls back to 'Your driver' when no name", () => {
    const out = buildDriverArrived({
      officeName: "Acme",
      arrivedAt: "now",
    });
    expect(out.textBody).toContain("Your driver");
  });
});

describe("buildSamplesPickedUp", () => {
  it("includes driver, office, time, and sample count when present", () => {
    const out = buildSamplesPickedUp({
      officeName: "Acme Clinic",
      driverName: "Pat",
      pickedUpAt: "Tue 3:30 pm",
      sampleCount: 7,
    });
    expect(out.subject).toBe("Samples picked up from Acme Clinic");
    expect(out.textBody).toContain("Pat");
    expect(out.textBody).toContain("Acme Clinic");
    expect(out.textBody).toContain("(7 samples)");
    expect(out.textBody).toContain("Tue 3:30 pm");
  });

  it("omits sample count when zero or missing", () => {
    const out = buildSamplesPickedUp({
      officeName: "Acme",
      pickedUpAt: "now",
    });
    expect(out.textBody).not.toContain("samples)");
    expect(out.textBody).toContain("Your driver");
  });
});

describe("HTML escaping", () => {
  it("escapes special chars in office and driver names (template injection)", () => {
    const out = buildDriverArrived({
      officeName: "Acme & <script>",
      driverName: "P<at>",
      arrivedAt: "now",
    });
    expect(out.htmlBody).not.toContain("<script>");
    expect(out.htmlBody).toContain("&lt;script&gt;");
    expect(out.htmlBody).toContain("P&lt;at&gt;");
  });
});
