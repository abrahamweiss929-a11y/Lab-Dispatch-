"use client";

import { useRef, type FormEvent } from "react";
import { flagRequestAction } from "../actions";

interface FlagForReviewButtonProps {
  requestId: string;
}

export function FlagForReviewButton({ requestId }: FlagForReviewButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const boundAction = flagRequestAction.bind(null, requestId);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    const reason = window.prompt("Why flag this request?");
    if (reason === null || reason.trim().length === 0) {
      event.preventDefault();
      return;
    }
    if (inputRef.current) {
      inputRef.current.value = reason.trim();
    }
  }

  return (
    <form
      action={boundAction}
      onSubmit={handleSubmit}
      className="inline-block"
    >
      <input ref={inputRef} type="hidden" name="reason" defaultValue="" />
      <button
        type="submit"
        className="text-xs font-bold text-amber-700 hover:underline"
      >
        Flag
      </button>
    </form>
  );
}
