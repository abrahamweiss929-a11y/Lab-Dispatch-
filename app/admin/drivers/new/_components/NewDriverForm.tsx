"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { createDriverAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";

export function NewDriverForm() {
  const [state, formAction] = useFormState(
    createDriverAction,
    INITIAL_ADMIN_FORM_STATE,
  );

  return (
    <form action={formAction} className="form-card space-y-4" noValidate>
      {state?.error ? (
        <p role="alert" className="alert-error">
          {state?.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Full name</span>
        <input
          type="text"
          name="fullName"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.fullName ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.fullName}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          type="email"
          name="email"
          className="rounded border border-gray-300 px-3 py-2"
          autoComplete="email"
        />
        {state?.fieldErrors?.email ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.email}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Phone</span>
        <input
          type="tel"
          name="phone"
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
          className="rounded border border-gray-300 px-3 py-2"
        />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked />
        <span className="font-medium">Active</span>
      </label>

      <div className="form-actions">
        <button
          type="submit"
        >
          Create driver
        </button>
        <Link
          href="/admin/drivers"
          className="px-4 py-2 text-sm hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
