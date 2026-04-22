"use client";

import Link from "next/link";
import { useFormState } from "react-dom";
import { createOfficeAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";

export function NewOfficeForm() {
  const [state, formAction] = useFormState(
    createOfficeAction,
    INITIAL_ADMIN_FORM_STATE,
  );

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state.error ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name</span>
        <input
          type="text"
          name="name"
          required
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state.fieldErrors.name ? (
          <span className="text-xs text-red-600">
            {state.fieldErrors.name}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">
          Slug{" "}
          <span className="font-normal text-gray-500">
            (optional — derived from name)
          </span>
        </span>
        <input
          type="text"
          name="slug"
          className="rounded border border-gray-300 px-3 py-2 font-mono text-xs"
        />
        {state.fieldErrors.slug ? (
          <span className="text-xs text-red-600">
            {state.fieldErrors.slug}
          </span>
        ) : null}
      </label>

      <fieldset className="space-y-2 rounded border border-gray-200 p-4">
        <legend className="px-1 text-sm font-medium">Address</legend>

        <label className="flex flex-col gap-1 text-sm">
          <span>Street</span>
          <input
            type="text"
            name="street"
            required
            className="rounded border border-gray-300 px-3 py-2"
          />
          {state.fieldErrors.street ? (
            <span className="text-xs text-red-600">
              {state.fieldErrors.street}
            </span>
          ) : null}
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="col-span-1 flex flex-col gap-1 text-sm">
            <span>City</span>
            <input
              type="text"
              name="city"
              required
              className="rounded border border-gray-300 px-3 py-2"
            />
            {state.fieldErrors.city ? (
              <span className="text-xs text-red-600">
                {state.fieldErrors.city}
              </span>
            ) : null}
          </label>
          <label className="col-span-1 flex flex-col gap-1 text-sm">
            <span>State</span>
            <input
              type="text"
              name="state"
              required
              maxLength={2}
              className="rounded border border-gray-300 px-3 py-2 uppercase"
            />
            {state.fieldErrors.state ? (
              <span className="text-xs text-red-600">
                {state.fieldErrors.state}
              </span>
            ) : null}
          </label>
          <label className="col-span-1 flex flex-col gap-1 text-sm">
            <span>ZIP</span>
            <input
              type="text"
              name="zip"
              required
              maxLength={5}
              className="rounded border border-gray-300 px-3 py-2"
            />
            {state.fieldErrors.zip ? (
              <span className="text-xs text-red-600">
                {state.fieldErrors.zip}
              </span>
            ) : null}
          </label>
        </div>
      </fieldset>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Phone</span>
        <input
          type="tel"
          name="phone"
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state.fieldErrors.phone ? (
          <span className="text-xs text-red-600">
            {state.fieldErrors.phone}
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
        {state.fieldErrors.email ? (
          <span className="text-xs text-red-600">
            {state.fieldErrors.email}
          </span>
        ) : null}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked />
        <span className="font-medium">Active</span>
      </label>

      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create office
        </button>
        <Link
          href="/admin/offices"
          className="rounded px-4 py-2 text-sm text-gray-600 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
