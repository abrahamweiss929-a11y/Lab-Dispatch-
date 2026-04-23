"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState } from "react-dom";
import type { Office } from "@/lib/types";
import { updateOfficeAction } from "../../actions";
import { INITIAL_ADMIN_FORM_STATE } from "@/lib/admin-form";

interface EditOfficeFormProps {
  office: Office;
}

export function EditOfficeForm({ office }: EditOfficeFormProps) {
  const boundAction = updateOfficeAction.bind(null, office.id);
  const [state, formAction] = useFormState(
    boundAction,
    INITIAL_ADMIN_FORM_STATE,
  );
  const [copied, setCopied] = useState(false);
  const pickupUrl = `/pickup/${office.slug}-${office.pickupUrlToken}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(pickupUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can fail in non-secure contexts; fall through.
    }
  }

  return (
    <form action={formAction} className="max-w-xl space-y-4">
      {state?.error ? (
        <p role="alert" className="rounded bg-red-50 p-3 text-sm text-red-700">
          {state?.error}
        </p>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name</span>
        <input
          type="text"
          name="name"
          required
          defaultValue={office.name}
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.name ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.name}
          </span>
        ) : null}
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Slug</span>
        <input
          type="text"
          name="slug"
          defaultValue={office.slug}
          className="rounded border border-gray-300 px-3 py-2 font-mono text-xs"
        />
        {state?.fieldErrors?.slug ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.slug}
          </span>
        ) : null}
      </label>

      <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm">
        <p className="font-medium">Pickup URL token</p>
        <p className="mt-1 font-mono text-xs text-gray-700">
          {office.pickupUrlToken}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Full pickup URL (share with this office):
        </p>
        <div className="mt-1 flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-xs">
            {pickupUrl}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded border border-gray-300 bg-white px-2 py-1 text-xs hover:bg-gray-100"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      <fieldset className="space-y-2 rounded border border-gray-200 p-4">
        <legend className="px-1 text-sm font-medium">Address</legend>

        <label className="flex flex-col gap-1 text-sm">
          <span>Street</span>
          <input
            type="text"
            name="street"
            required
            defaultValue={office.address.street}
            className="rounded border border-gray-300 px-3 py-2"
          />
          {state?.fieldErrors?.street ? (
            <span className="text-xs text-red-600">
              {state?.fieldErrors?.street}
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
              defaultValue={office.address.city}
              className="rounded border border-gray-300 px-3 py-2"
            />
            {state?.fieldErrors?.city ? (
              <span className="text-xs text-red-600">
                {state?.fieldErrors?.city}
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
              defaultValue={office.address.state}
              className="rounded border border-gray-300 px-3 py-2 uppercase"
            />
            {state?.fieldErrors?.state ? (
              <span className="text-xs text-red-600">
                {state?.fieldErrors?.state}
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
              defaultValue={office.address.zip}
              className="rounded border border-gray-300 px-3 py-2"
            />
            {state?.fieldErrors?.zip ? (
              <span className="text-xs text-red-600">
                {state?.fieldErrors?.zip}
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
          defaultValue={office.phone ?? ""}
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
          defaultValue={office.email ?? ""}
          className="rounded border border-gray-300 px-3 py-2"
        />
        {state?.fieldErrors?.email ? (
          <span className="text-xs text-red-600">
            {state?.fieldErrors?.email}
          </span>
        ) : null}
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="active"
          defaultChecked={office.active}
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
          href="/admin/offices"
          className="rounded px-4 py-2 text-sm text-gray-600 hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
