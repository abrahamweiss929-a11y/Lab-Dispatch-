import { describe, it, expect } from "vitest";
import { makeFakeSupabase } from "./fake-supabase";

describe("fake-supabase helper", () => {
  it("records chained calls with their table and op", async () => {
    const client = makeFakeSupabase();
    client.__enqueue("offices", "select", {
      data: [{ id: "o1", name: "X" }],
      error: null,
    });
    const res = await client
      .from("offices")
      .select("*")
      .order("name", { ascending: true });
    expect(res.data).toEqual([{ id: "o1", name: "X" }]);
    const calls = client.__calls();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls.map((c) => c.method)).toEqual(["select", "order"]);
    expect(calls[0].table).toBe("offices");
    expect(calls[0].op).toBe("select");
  });

  it("resolves with a canned error response when queued", async () => {
    const client = makeFakeSupabase();
    client.__enqueue("offices", "select", {
      data: null,
      error: { code: "PGRST301", message: "boom" },
    });
    const res = await client.from("offices").select("*");
    expect(res.error).toEqual({ code: "PGRST301", message: "boom" });
  });

  it("tracks the current op through insert/update/delete", async () => {
    const client = makeFakeSupabase();
    client.__enqueue("offices", "insert", {
      data: { id: "o1" },
      error: null,
    });
    await client
      .from("offices")
      .insert({ name: "x" })
      .select()
      .single();
    const calls = client.__calls();
    expect(calls[0].op).toBe("insert");
    expect(calls[0].method).toBe("insert");
    // The follow-on .select() and .single() are recorded under op=insert
    // because the adapter's "insert then read-back" chain stays one op.
    expect(calls.every((c) => c.op === "insert")).toBe(true);
  });

  it("throws a helpful error when no response is queued", async () => {
    const client = makeFakeSupabase();
    await expect(async () => {
      await client.from("offices").select("*");
    }).rejects.toThrow(/no response queued/);
  });

  it("__reset clears queues and calls", async () => {
    const client = makeFakeSupabase();
    client.__enqueue("offices", "select", { data: [], error: null });
    await client.from("offices").select("*");
    expect(client.__calls().length).toBeGreaterThan(0);
    client.__reset();
    expect(client.__calls()).toEqual([]);
    // After reset, queues are empty — next call throws.
    await expect(async () => {
      await client.from("offices").select("*");
    }).rejects.toThrow(/no response queued/);
  });
});
