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
    const id = `email-mock-${state.counter}`;
    state.counter += 1;
    const record: SentEmailRecord = {
      to: params.to,
      subject: params.subject,
      body: params.body,
      id,
      sentAt: new Date().toISOString(),
    };
    state.sent.push(record);
    return { id };
  },
};

export function getSentEmails(): readonly SentEmailRecord[] {
  return state.sent;
}

export function resetEmailMock(): void {
  state.sent = [];
  state.counter = 0;
}
