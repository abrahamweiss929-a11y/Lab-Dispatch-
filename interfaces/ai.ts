import { NotConfiguredError } from "@/lib/errors";
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

export function createRealAiService(): AiService {
  return {
    async parsePickupMessage(
      _params: ParsePickupMessageParams,
    ): Promise<ParsePickupMessageResult> {
      throw new NotConfiguredError({
        service: "ai (Anthropic)",
        envVar: "ANTHROPIC_API_KEY",
      });
    },
  };
}
