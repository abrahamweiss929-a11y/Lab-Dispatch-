"use server";

import { revalidatePath } from "next/cache";
import { getServices } from "@/interfaces";
import { requireDispatcherSession } from "@/lib/require-dispatcher";

export async function convertMessageToRequestAction(
  messageId: string,
): Promise<void> {
  requireDispatcherSession();
  await getServices().storage.createRequestFromMessage(messageId);
  revalidatePath("/dispatcher/messages");
  revalidatePath("/dispatcher/requests");
}
