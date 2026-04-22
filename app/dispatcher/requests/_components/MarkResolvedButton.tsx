"use client";

import type { FormEvent } from "react";
import { markResolvedAction } from "../actions";

interface MarkResolvedButtonProps {
  requestId: string;
}

export function MarkResolvedButton({ requestId }: MarkResolvedButtonProps) {
  const boundAction = markResolvedAction.bind(null, requestId);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    if (!window.confirm("Mark this request completed?")) {
      event.preventDefault();
    }
  }

  return (
    <form
      action={boundAction}
      onSubmit={handleSubmit}
      className="inline-block"
    >
      <button
        type="submit"
        className="text-xs text-green-700 hover:underline"
      >
        Resolve
      </button>
    </form>
  );
}
