"use client";

import type { FormEvent } from "react";
import { deleteDoctorAction } from "../actions";

interface DeleteDoctorButtonProps {
  doctorId: string;
  doctorName: string;
}

/**
 * Client wrapper around the `deleteDoctorAction` server function. The
 * server action is imported directly (Next streams it over the wire to
 * the client); we wrap the surrounding form in an `onSubmit` that asks
 * for confirmation before the form submits. Using `window.confirm`
 * intentionally — see plan's open question #3 (v1 UX).
 */
export function DeleteDoctorButton({
  doctorId,
  doctorName,
}: DeleteDoctorButtonProps) {
  const boundAction = deleteDoctorAction.bind(null, doctorId);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    if (!window.confirm(`Delete ${doctorName}? This cannot be undone.`)) {
      event.preventDefault();
    }
  }

  return (
    <form action={boundAction} onSubmit={handleSubmit}>
      <button type="submit" className="btn-danger">
        Delete
      </button>
    </form>
  );
}
