"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { createDoctorAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";

interface OfficeOption {
  id: string;
  name: string;
}

interface NewDoctorFormProps {
  offices: OfficeOption[];
}

export function NewDoctorForm({ offices }: NewDoctorFormProps) {
  const [state, formAction] = useFormState(
    createDoctorAction,
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
        <span className="font-medium">Office</span>
        <select
          name="officeId"
          defaultValue=""
          className="rounded border border-gray-300 px-3 py-2"
        >
          <option value="" disabled>
            Choose an office
          </option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {state?.fieldErrors?.officeId ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.officeId}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Doctor name</span>
        <input
          type="text"
          name="name"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.name ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.name}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Phone</span>
        <input
          type="tel"
          name="phone"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.phone ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.phone}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          type="email"
          name="email"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.email ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.email}
          </span>
        ) : null}
      </label>

      <div className="form-actions">
        <button
          type="submit"
        >
          Create doctor
        </button>
        <Link
          href="/admin/doctors"
          className="px-4 py-2 text-sm hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
