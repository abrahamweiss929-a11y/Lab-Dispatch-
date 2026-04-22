import type {
  SentSmsRecord,
  SmsSendParams,
  SmsSendResult,
  SmsService,
} from "@/interfaces/sms";

interface SmsMockState {
  sent: SentSmsRecord[];
  counter: number;
}

const state: SmsMockState = {
  sent: [],
  counter: 0,
};

export const smsMock: SmsService = {
  async sendSms(params: SmsSendParams): Promise<SmsSendResult> {
    const id = `sms-mock-${state.counter}`;
    state.counter += 1;
    const record: SentSmsRecord = {
      to: params.to,
      body: params.body,
      id,
      status: "queued",
      sentAt: new Date().toISOString(),
    };
    state.sent.push(record);
    return { id, status: "queued" };
  },
};

export function getSent(): readonly SentSmsRecord[] {
  return state.sent;
}

export function resetSmsMock(): void {
  state.sent = [];
  state.counter = 0;
}
