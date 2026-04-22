"use client";

import { Suspense } from "react";
import { useFormState } from "react-dom";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { signInAction, type SignInFormState } from "./actions";

const INITIAL_STATE: SignInFormState = { error: null };

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "";
  const [state, formAction] = useFormState(signInAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Email</span>
        <input
          type="email"
          name="email"
          required
          className="rounded border border-gray-300 px-3 py-2"
          autoComplete="email"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          type="password"
          name="password"
          required
          className="rounded border border-gray-300 px-3 py-2"
          autoComplete="current-password"
        />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
      >
        Sign in
      </button>
      <Link
        href="/"
        className="text-center text-sm text-gray-500 hover:underline"
      >
        Cancel
      </Link>
    </form>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm text-gray-600">
          Lab Dispatch operator console.
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        {/*
          Mock-grade credential hint block. Remove when Supabase Auth lands —
          see BLOCKERS.md [supabase].
        */}
        <div className="mt-8 rounded border border-dashed border-gray-300 p-3 text-xs text-gray-600">
          <p className="font-medium">Mock test credentials</p>
          <ul className="mt-1 list-disc pl-4">
            <li>driver@test</li>
            <li>dispatcher@test</li>
            <li>admin@test</li>
          </ul>
          <p className="mt-1">Shared password: test1234</p>
        </div>
      </div>
    </main>
  );
}
