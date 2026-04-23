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

// The real adapter lives in a `"server-only"` module so webpack errors
// if anyone accidentally pulls it into a Client Component. Callers
// continue to import the interface + helper types from this file.
export { createRealSmsService } from "./sms.real";
