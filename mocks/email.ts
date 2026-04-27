import type {
  EmailSendParams,
  EmailSendResult,
  EmailService,
  SentEmailRecord,
} from "@/interfaces/email";

interface EmailMockState {
  sent: SentEmailRecord[];
  counter: number;
}

const state: EmailMockState = {
  sent: [],
  counter: 0,
};

export const emailMock: EmailService = {
  async sendEmail(params: EmailSendParams): Promise<EmailSendResult> {
    if (!params.to) {
      throw new Error("to is required");
    }
    const messageId = `email-mock-${state.counter}`;
    state.counter += 1;
    const record: SentEmailRecord = {
      to: params.to,
      subject: params.subject,
      textBody: params.textBody,
      htmlBody: params.htmlBody,
      fromName: params.fromName,
      replyTo: params.replyTo,
      messageId,
      sentAt: new Date().toISOString(),
    };
    state.sent.push(record);
    return { messageId };
  },
};

export function getSentEmails(): readonly SentEmailRecord[] {
  return state.sent;
}

export function resetEmailMock(): void {
  state.sent = [];
  state.counter = 0;
}
