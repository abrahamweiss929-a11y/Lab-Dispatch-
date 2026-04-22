import { describe, expect, it, vi, beforeEach } from "vitest";

const revalidatePathMock = vi.fn();
const requireDispatcherSessionMock = vi.fn(() => ({
  userId: "dispatcher-test",
  role: "dispatcher" as const,
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("@/lib/require-dispatcher", () => ({
  requireDispatcherSession: () => requireDispatcherSessionMock(),
}));

import { convertMessageToRequestAction } from "./actions";
import { storageMock, resetStorageMock, seedMessage } from "@/mocks/storage";

describe("dispatcher/messages server actions", () => {
  beforeEach(() => {
    resetStorageMock();
    revalidatePathMock.mockClear();
    requireDispatcherSessionMock.mockReset();
    requireDispatcherSessionMock.mockReturnValue({
      userId: "dispatcher-test",
      role: "dispatcher",
    });
  });

  it("converts a message to a pending pickup request", async () => {
    seedMessage({
      id: "msg-1",
      channel: "sms",
      fromIdentifier: "+15551234567",
      body: "need pickup asap",
      receivedAt: new Date().toISOString(),
    });

    await convertMessageToRequestAction("msg-1");

    const requests = await storageMock.listPickupRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.status).toBe("pending");
    expect(requests[0]?.channel).toBe("sms");
    expect(requests[0]?.sourceIdentifier).toBe("+15551234567");
    expect(requests[0]?.rawMessage).toBe("need pickup asap");

    const messages = await storageMock.listMessages();
    expect(messages[0]?.pickupRequestId).toBe(requests[0]?.id);

    expect(revalidatePathMock).toHaveBeenCalledWith("/dispatcher/messages");
    expect(revalidatePathMock).toHaveBeenCalledWith("/dispatcher/requests");
  });

  it("throws on unknown messageId", async () => {
    await expect(
      convertMessageToRequestAction("does-not-exist"),
    ).rejects.toThrow(/not found/);
  });

  it("bails out on auth failure before touching storage", async () => {
    seedMessage({
      id: "msg-2",
      channel: "sms",
      fromIdentifier: "+15559999999",
      body: "test",
      receivedAt: new Date().toISOString(),
    });
    requireDispatcherSessionMock.mockImplementationOnce(() => {
      throw new Error("REDIRECT:/login");
    });
    const spy = vi.spyOn(storageMock, "createRequestFromMessage");
    await expect(convertMessageToRequestAction("msg-2")).rejects.toThrow(
      /REDIRECT:\/login/,
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
