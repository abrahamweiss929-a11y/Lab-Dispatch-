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
  };
});

vi.mock("@anthropic-ai/sdk", () => {
  // The SDK's default export is the `Anthropic` class. A new-style
  // factory that returns `{ messages: { create } }` lets `new Anthropic(...)`
  // produce a client whose `messages.create` is the test-controlled mock.
  const AnthropicCtor = vi.fn(() => ({
    messages: { create: hoisted.holder.current },
  }));
  return { default: AnthropicCtor };
});

import type { AiService } from "./ai";

const STUB_KEY = "sk-ant-test";

let service: AiService;

function okResponse(json: string) {
  return { content: [{ type: "text", text: json }] };
}

interface ErrorSpy {
  mock: { calls: unknown[][] };
  mockRestore(): void;
  (...args: unknown[]): void;
}

describe("createRealAiService() — hermetic coverage against mocked @anthropic-ai/sdk", () => {
  let errorSpy: ErrorSpy;

  beforeEach(async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", STUB_KEY);
    // Fresh module graph so the mocked SDK binding is freshly resolved
    // inside `ai.real.ts` each test.
    vi.resetModules();
    hoisted.holder.current = vi.fn();
    errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {}) as unknown as ErrorSpy;
    const mod = await import("./ai.real");
    service = mod.createRealAiService();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    errorSpy.mockRestore();
  });

  it("returns parsed object on happy path", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(
        JSON.stringify({
          urgency: "urgent",
          sampleCount: 3,
          specialInstructions: "back entrance",
          confidence: 0.82,
        }),
      ),
    );
    const result = await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "Please pick up 3 urgent samples, use back entrance",
    });
    expect(result).toEqual({
      urgency: "urgent",
      sampleCount: 3,
      specialInstructions: "back entrance",
      confidence: 0.82,
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("ignores extra fields in Claude's JSON response", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(
        JSON.stringify({
          urgency: "routine",
          sampleCount: 2,
          specialInstructions: "after 3pm",
          confidence: 0.7,
          note: "this should be dropped",
          priority: 9,
        }),
      ),
    );
    const result = await service.parsePickupMessage({
      channel: "email",
      from: "office@example.test",
      body: "2 samples, after 3pm",
    });
    // Exactly the four documented fields, nothing else.
    expect(Object.keys(result).sort()).toEqual(
      ["confidence", "sampleCount", "specialInstructions", "urgency"].sort(),
    );
    expect(result.confidence).toBe(0.7);
  });

  it("returns { confidence: 0 } when response text is not valid JSON", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse("sorry, can't help"),
    );
    const result = await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "hey",
    });
    expect(result).toEqual({ confidence: 0 });
    // Non-JSON is not an error path — the guard handles it silently so
    // we don't pollute logs with routine Claude refusals / hallucinations.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns { confidence: 0 } when JSON parses but shape is wrong (non-numeric confidence)", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(JSON.stringify({ confidence: "high" })),
    );
    const result = await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "x",
    });
    expect(result).toEqual({ confidence: 0 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns { confidence: 0 } when the response has no text block", async () => {
    hoisted.holder.current.mockResolvedValueOnce({ content: [] });
    const result = await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "x",
    });
    expect(result).toEqual({ confidence: 0 });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns { confidence: 0 } and does not throw when the SDK rejects", async () => {
    hoisted.holder.current.mockRejectedValueOnce(new Error("rate_limit"));
    const result = await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "x",
    });
    expect(result).toEqual({ confidence: 0 });
    // Error path logs exactly once with a context string.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    // Defense in depth on the "never log the key" rule: every logged arg
    // must be a string/value that does NOT contain the stubbed key.
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        const serialized =
          typeof arg === "string" ? arg : JSON.stringify(arg);
        expect(serialized).not.toContain(STUB_KEY);
      }
    }
  });

  it("throws NotConfiguredError on first parsePickupMessage call when ANTHROPIC_API_KEY is unset", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.resetModules();
    const mod = await import("./ai.real");
    // Construction is deferred — no throw here (matches storage.real /
    // auth.real, which lazily resolve env via their shared client
    // getter). The env check fires on the first method invocation.
    const deferredService = mod.createRealAiService();
    try {
      await deferredService.parsePickupMessage({
        channel: "sms",
        from: "+15551234567",
        body: "hi",
      });
      throw new Error("expected parsePickupMessage to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).name).toBe("NotConfiguredError");
      expect(
        (err as Error & { envVar?: string }).envVar,
      ).toBe("ANTHROPIC_API_KEY");
    }
  });

  it("calls messages.create with model claude-haiku-4-5-20251001", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(JSON.stringify({ confidence: 0.5 })),
    );
    await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "hi",
    });
    expect(hoisted.holder.current).toHaveBeenCalledTimes(1);
    const firstArg = hoisted.holder.current.mock.calls[0][0] as {
      model: string;
    };
    expect(firstArg.model).toBe("claude-haiku-4-5-20251001");
  });

  it("truncates body input to 4000 characters before sending", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(JSON.stringify({ confidence: 0.5 })),
    );
    await service.parsePickupMessage({
      channel: "email",
      from: "office@example.test",
      body: "x".repeat(5000),
    });
    const callArg = hoisted.holder.current.mock.calls[0][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(callArg.messages).toHaveLength(1);
    expect(callArg.messages[0].role).toBe("user");
    expect(callArg.messages[0].content).toHaveLength(4000);
  });

  it("forwards a system prompt containing 'Return only JSON'", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(JSON.stringify({ confidence: 0.5 })),
    );
    await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "hi",
    });
    const callArg = hoisted.holder.current.mock.calls[0][0] as {
      system: string;
    };
    expect(typeof callArg.system).toBe("string");
    expect(callArg.system).toContain("Return only JSON");
  });

  it("drops out-of-range confidence values", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(JSON.stringify({ confidence: 1.5, urgency: "routine" })),
    );
    const result = await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "x",
    });
    expect(result).toEqual({ confidence: 0 });
  });

  it("drops invalid urgency / sampleCount / specialInstructions but keeps confidence", async () => {
    hoisted.holder.current.mockResolvedValueOnce(
      okResponse(
        JSON.stringify({
          urgency: "whenever",
          sampleCount: 0,
          specialInstructions: "   ",
          confidence: 0.42,
        }),
      ),
    );
    const result = await service.parsePickupMessage({
      channel: "sms",
      from: "+15551234567",
      body: "x",
    });
    expect(result).toEqual({ confidence: 0.42 });
  });
});
