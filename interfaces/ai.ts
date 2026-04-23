import type { PickupChannel, PickupUrgency } from "@/lib/types";

export interface ParsePickupMessageParams {
  channel: PickupChannel;
  from: string;
  body: string;
}

export interface ParsePickupMessageResult {
  urgency?: PickupUrgency;
  sampleCount?: number;
  specialInstructions?: string;
  confidence: number;
}

export interface AiService {
  parsePickupMessage(
    params: ParsePickupMessageParams,
  ): Promise<ParsePickupMessageResult>;
}

// The real adapter lives in a `"server-only"` module so webpack errors
// if anyone accidentally pulls it into a Client Component. Callers
// continue to import the interface + helper types from this file.
export { createRealAiService } from "./ai.real";
