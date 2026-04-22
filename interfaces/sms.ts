import { NotConfiguredError } from "@/lib/errors";

export interface SmsSendParams {
  to: string;
  body: string;
}

export interface SmsSendResult {
  id: string;
  status: "queued";
}

export interface SentSmsRecord extends SmsSendParams, SmsSendResult {
  sentAt: string;
}

export interface SmsService {
  sendSms(params: SmsSendParams): Promise<SmsSendResult>;
}

export function createRealSmsService(): SmsService {
  return {
    async sendSms(_params: SmsSendParams): Promise<SmsSendResult> {
      throw new NotConfiguredError({
        service: "sms (Twilio)",
        envVar: "TWILIO_ACCOUNT_SID",
      });
    },
  };
}
