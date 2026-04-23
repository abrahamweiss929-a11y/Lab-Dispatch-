import { describe, it, expect, vi } from "vitest";
import { hasSentinelOffice, seedDemoData } from "./seed-live-data";

type MockSb = ReturnType<typeof import("@/interfaces/supabase-client").getSupabaseAdminClient>;

function makeMockSb(opts: {
  sentinelExists?: boolean;
  officeInsertId?: string;
  doctorInsertId?: string;
  officeError?: string;
  doctorError?: string;
} = {}): { sb: MockSb; fromFn: ReturnType<typeof vi.fn>; insertFn: ReturnType<typeof vi.fn> } {
  const {
    sentinelExists = false,
    officeInsertId = "office-demo-1",
    doctorInsertId = "doctor-demo-1",
    officeError,
    doctorError,
  } = opts;

  const singleFn = vi.fn()
    // First call: hasSentinelOffice or officeInsert single
    .mockResolvedValueOnce(
      sentinelExists
        ? { data: { id: "existing" }, error: null }
        : { data: null, error: null },
    )
    // Second call: officeInsert single
    .mockResolvedValueOnce(
      officeError
        ? { data: null, error: { message: officeError } }
        : { data: { id: officeInsertId }, error: null },
    )
    // Third call: doctorInsert single
    .mockResolvedValueOnce(
      doctorError
        ? { data: null, error: { message: doctorError } }
        : { data: { id: doctorInsertId }, error: null },
    );

  const selectFn = vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle: singleFn }) });
  const insertFn = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn }) });
  const fromFn = vi.fn().mockReturnValue({ select: selectFn, insert: insertFn });

  const sb = { from: fromFn } as unknown as MockSb;
  return { sb, fromFn, insertFn };
}

describe("hasSentinelOffice", () => {
  it("returns false when no sentinel office exists", async () => {
    const { sb } = makeMockSb({ sentinelExists: false });
    const result = await hasSentinelOffice(sb);
    expect(result).toBe(false);
  });

  it("returns true when sentinel office already exists", async () => {
    const { sb } = makeMockSb({ sentinelExists: true });
    const result = await hasSentinelOffice(sb);
    expect(result).toBe(true);
  });
});

describe("seedDemoData", () => {
  it("inserts an office and a doctor and returns their IDs", async () => {
    const { sb, fromFn } = makeMockSb({
      officeInsertId: "office-abc",
      doctorInsertId: "doctor-xyz",
    });
    // hasSentinelOffice is NOT called inside seedDemoData — skip the first singleFn result
    // by making a fresh mock for seedDemoData only
    const singleFn2 = vi.fn()
      .mockResolvedValueOnce({ data: { id: "office-abc" }, error: null })
      .mockResolvedValueOnce({ data: { id: "doctor-xyz" }, error: null });
    const insertFn2 = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn2 }) });
    const fromFn2 = vi.fn().mockReturnValue({ insert: insertFn2 });
    const sb2 = { from: fromFn2 } as unknown as MockSb;

    const result = await seedDemoData(sb2);
    expect(result.officeId).toBe("office-abc");
    expect(result.doctorId).toBe("doctor-xyz");

    // Should insert into offices then doctors
    const tableNames = fromFn2.mock.calls.map((c: [string]) => c[0]);
    expect(tableNames[0]).toBe("offices");
    expect(tableNames[1]).toBe("doctors");
  });

  it("links the doctor to the inserted office", async () => {
    const singleFn = vi.fn()
      .mockResolvedValueOnce({ data: { id: "office-new" }, error: null })
      .mockResolvedValueOnce({ data: { id: "doctor-new" }, error: null });
    const insertFn = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn }) });
    const fromFn = vi.fn().mockReturnValue({ insert: insertFn });
    const sb = { from: fromFn } as unknown as MockSb;

    await seedDemoData(sb);

    // The doctor insert arg should contain office_id = "office-new"
    const doctorInsertArg = insertFn.mock.calls[1][0] as Record<string, unknown>;
    expect(doctorInsertArg.office_id).toBe("office-new");
  });

  it("throws when office insert fails", async () => {
    const singleFn = vi.fn().mockResolvedValueOnce({
      data: null,
      error: { message: "unique constraint violation" },
    });
    const insertFn = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn }) });
    const fromFn = vi.fn().mockReturnValue({ insert: insertFn });
    const sb = { from: fromFn } as unknown as MockSb;

    await expect(seedDemoData(sb)).rejects.toThrow(/insert offices failed/);
  });
});
