import { aiMock, resetAiMock } from "@/mocks/ai";
import { authMock, resetAuthMock } from "@/mocks/auth";
import { emailMock, resetEmailMock } from "@/mocks/email";
import { mapsMock, resetMapsMock } from "@/mocks/maps";
import { smsMock, resetSmsMock } from "@/mocks/sms";
import { storageMock, resetStorageMock } from "@/mocks/storage";
import { isSeeded, resetSeedFlag, seedMocks } from "@/mocks/seed";

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
  ParsedInboundEmail,
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
  DispatcherDashboardCounts,
  DriverAccountSummary,
  ListDriverLocationsFilter,
  ListMessagesFilter,
  ListPickupRequestsFilter,
  ListRoutesFilter,
  NewDoctor,
  NewDriver,
  NewDriverLocation,
  NewMessage,
  NewOffice,
  NewPickupRequest,
  NewRoute,
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

/**
 * Auto-seeds the mock storage with demo fixtures at most once per
 * process. Called from `getServices()` before returning mock services.
 *
 * Gates (all must pass):
 *   - `process.env.NODE_ENV !== "test"` — keep tests pristine.
 *   - `process.env.SEED_MOCKS !== "false"` — opt-out escape hatch.
 *   - `!isSeeded()` — idempotent across repeat `getServices()` calls and
 *     across Next.js HMR reloads (flag lives on `globalThis`).
 *
 * Any seed error is caught and logged via `console.warn` — a broken
 * seeder must NOT prevent the app from booting.
 */
function maybeAutoSeed(): void {
  if (process.env.NODE_ENV === "test") return;
  if (process.env.SEED_MOCKS === "false") return;
  if (isSeeded()) return;
  try {
    seedMocks();
  } catch (err) {
    console.warn("seedMocks() failed; continuing with empty mock storage", err);
  }
}

export function getServices(): Services {
  const flag = process.env.USE_MOCKS;
  if (flag === undefined || flag === "true") {
    maybeAutoSeed();
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
  resetSeedFlag();
}

export type {
  AdminDashboardCounts,
  AiService,
  AuthService,
  DispatcherDashboardCounts,
  DriverAccountSummary,
  EmailSendParams,
  EmailSendResult,
  EmailService,
  EtaParams,
  EtaResult,
  LatLng,
  ListDriverLocationsFilter,
  ListMessagesFilter,
  ListPickupRequestsFilter,
  ListRoutesFilter,
  MapsService,
  NewDoctor,
  NewDriver,
  NewDriverLocation,
  NewMessage,
  NewOffice,
  NewPickupRequest,
  NewRoute,
  ParsedInboundEmail,
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
