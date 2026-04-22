import { NotConfiguredError } from "@/lib/errors";

export interface EmailSendParams {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSendResult {
  id: string;
}

export interface SentEmailRecord extends EmailSendParams, EmailSendResult {
  sentAt: string;
}

export interface InboundEmailPayload {
  from: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
  messageId: string;
}

export interface EmailService {
  sendEmail(params: EmailSendParams): Promise<EmailSendResult>;
}

export function createRealEmailService(): EmailService {
  return {
    async sendEmail(_params: EmailSendParams): Promise<EmailSendResult> {
      throw new NotConfiguredError({
        service: "email (Postmark)",
        envVar: "POSTMARK_SERVER_TOKEN",
      });
    },
  };
}
