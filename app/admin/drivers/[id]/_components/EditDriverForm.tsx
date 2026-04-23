"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import type { Driver } from "@/lib/types";
import { updateDriverAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";

interface EditDriverFormProps {
  driver: Driver;
  email: string;
}

export function EditDriverForm({ driver, email }: EditDriverFormProps) {
  const boundAction = updateDriverAction.bind(null, driver.profileId);
  const [state, formAction] = useFormState(
    boundAction,
    INITIAL_ADMIN_FORM_STATE,
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4" noValidate>
      {state?.error ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {state?.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Full name</span>
        <input
          type="text"
          name="fullName"
          defaultValue={driver.fullName}
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.fullName ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.fullName}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email (read-only)</span>
        <input
          type="email"
          value={email}
          readOnly
          className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-gray-600"
        />
        <span className="text-xs text-gray-500">
          Changing email requires touching the auth account; deferred until
          Supabase Auth lands.
        </span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Phone</span>
        <input
          type="tel"
          name="phone"
          defaultValue={driver.phone ?? ""}
          className="rounded border border-gray-300 px-3 py-2"
          autoComplete="tel"
        />
        {state?.fieldErrors?.phone ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.phone}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Vehicle label</span>
        <input
          type="text"
          name="vehicleLabel"
          defaultValue={driver.vehicleLabel ?? ""}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={driver.active}
        />
        <span className="font-medium">Active</span>
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Save changes
        </button>
        <Link
          href="/admin/drivers"
          className="rounded px-4 py-2 text-sm text-gray-600 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
