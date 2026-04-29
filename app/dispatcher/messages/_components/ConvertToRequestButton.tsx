"use client";

import type { FormEvent } from "react";
import { convertMessageToRequestAction } from "../actions";

interface ConvertToRequestButtonProps {
  messageId: string;
}

export function ConvertToRequestButton({
  messageId,
}: ConvertToRequestButtonProps) {
  const boundAction = convertMessageToRequestAction.bind(null, messageId);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    if (
      !window.confirm(
        "Create a new pending pickup request from this message? If the message already has a linked request, this creates an additional standalone one you can edit independently.",
      )
    ) {
      event.preventDefault();
    }
  }

  return (
    <form
      action={boundAction}
      onSubmit={handleSubmit}
      className="inline-block"
    >
      <button type="submit" className="text-xs font-bold text-[var(--brand-700)] hover:underline">
        Convert to request
      </button>
    </form>
  );
}
