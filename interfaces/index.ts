import { aiMock, resetAiMock } from "@/mocks/ai";
import { authMock, resetAuthMock } from "@/mocks/auth";
import { emailMock, resetEmailMock } from "@/mocks/email";
import { mapsMock, resetMapsMock } from "@/mocks/maps";
import { smsMock, resetSmsMock } from "@/mocks/sms";
import { storageMock, resetStorageMock } from "@/mocks/storage";

import { createRealAiService } from "./ai";
import { createRealAuthService } from "./auth";
import { createRealEmailService } from "./email";
import { createRealMapsService } from "./maps";
import { createRealSmsService } from "./sms";
import { createRealStorageService } from "./storage";

import type { AiService } from "./ai";
import type { AuthService, Session, SignInParams } from "./auth";
import type {
  EmailSendParams,
  EmailSendResult,
  EmailService,
  InboundEmailPayload,
  SentEmailRecord,
} from "./email";
import type {
  EtaParams,
  EtaResult,
  LatLng,
  MapsService,
  RouteFromStopsParams,
  RouteFromStopsResult,
} from "./maps";
import type {
  SentSmsRecord,
  SmsSendParams,
  SmsSendResult,
  SmsService,
} from "./sms";
import type {
  AdminDashboardCounts,
  DriverAccountSummary,
  ListPickupRequestsFilter,
  NewDoctor,
  NewDriver,
  NewOffice,
  NewPickupRequest,
  StorageService,
} from "./storage";
import type {
  ParsePickupMessageParams,
  ParsePickupMessageResult,
} from "./ai";

export interface Services {
  sms: SmsService;
  email: EmailService;
  storage: StorageService;
  maps: MapsService;
  ai: AiService;
  auth: AuthService;
}

export function getServices(): Services {
  const flag = process.env.USE_MOCKS;
  if (flag === undefined || flag === "true") {
    return {
      sms: smsMock,
      email: emailMock,
      storage: storageMock,
      maps: mapsMock,
      ai: aiMock,
      auth: authMock,
    };
  }
  if (flag === "false") {
    return {
      sms: createRealSmsService(),
      email: createRealEmailService(),
      storage: createRealStorageService(),
      maps: createRealMapsService(),
      ai: createRealAiService(),
      auth: createRealAuthService(),
    };
  }
  throw new Error(`USE_MOCKS must be 'true' or 'false', got: ${flag}`);
}

export function resetAllMocks(): void {
  resetSmsMock();
  resetEmailMock();
  resetStorageMock();
  resetMapsMock();
  resetAiMock();
  resetAuthMock();
}

export type {
  AdminDashboardCounts,
  AiService,
  AuthService,
  DriverAccountSummary,
  EmailSendParams,
  EmailSendResult,
  EmailService,
  EtaParams,
  EtaResult,
  InboundEmailPayload,
  LatLng,
  ListPickupRequestsFilter,
  MapsService,
  NewDoctor,
  NewDriver,
  NewOffice,
  NewPickupRequest,
  ParsePickupMessageParams,
  ParsePickupMessageResult,
  RouteFromStopsParams,
  RouteFromStopsResult,
  SentEmailRecord,
  SentSmsRecord,
  Session,
  SignInParams,
  SmsSendParams,
  SmsSendResult,
  SmsService,
  StorageService,
};
