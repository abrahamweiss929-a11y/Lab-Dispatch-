import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression test for F-05: every form that submits to a server action must use
// noValidate so server-side fieldErrors are never blocked by native browser
// constraint validation.
const FORM_FILES = [
  "app/pickup/[slugToken]/_components/PickupRequestForm.tsx",
  "app/admin/drivers/new/_components/NewDriverForm.tsx",
  "app/admin/drivers/[id]/_components/EditDriverForm.tsx",
  "app/admin/doctors/new/_components/NewDoctorForm.tsx",
  "app/admin/doctors/[id]/_components/EditDoctorForm.tsx",
  "app/admin/offices/new/_components/NewOfficeForm.tsx",
  "app/admin/offices/[id]/_components/EditOfficeForm.tsx",
  "app/dispatcher/routes/new/_components/NewRouteForm.tsx",
  "app/dispatcher/requests/new/_components/NewManualRequestForm.tsx",
];

const ROOT = join(import.meta.dirname, "..");

describe("form HTML5 validation sweep (F-05)", () => {
  for (const rel of FORM_FILES) {
    it(`${rel} has noValidate on the <form> element`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      expect(src).toMatch(/noValidate/);
    });

    it(`${rel} has no required= attribute on any input/select/textarea`, () => {
      const src = readFileSync(join(ROOT, rel), "utf8");
      // Match the HTML attribute form: required followed by whitespace, />, or >
      expect(src).not.toMatch(/\brequired(?=\s|\/?>)/);
    });
  }
});
