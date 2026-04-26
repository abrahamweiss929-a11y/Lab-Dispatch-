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
          className="rounded-lg border border-[var(--line)] px-3 py-3 outline-none focus:border-[var(--brand-600)] focus:ring-4 focus:ring-teal-100"
          autoComplete="email"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Password</span>
        <input
          type="password"
          name="password"
          required
          className="rounded-lg border border-[var(--line)] px-3 py-3 outline-none focus:border-[var(--brand-600)] focus:ring-4 focus:ring-teal-100"
          autoComplete="current-password"
        />
      </label>
      {state?.error ? (
        <p role="alert" className="alert-error">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn-primary mt-1"
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
    <main className="auth-page">
      <div className="route-visual" aria-hidden="true">
        <span className="route-line route-line-one" />
        <span className="route-line route-line-two" />
        <span className="route-node route-node-a" />
        <span className="route-node route-node-b" />
        <span className="route-node route-node-c" />
      </div>
      <div className="auth-card mx-auto p-6">
        <div className="brand-lockup">
          <span className="brand-mark brand-mark-small" aria-hidden="true" />
          <div>
            <p className="brand-title">Lab Dispatch</p>
            <p className="brand-subtitle">Operator console</p>
          </div>
        </div>
        <h1 className="mt-8 text-3xl font-black tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          Choose a mock account to preview each workspace.
        </p>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
        {/*
          Mock-grade credential hint block. Remove when Supabase Auth lands —
          see BLOCKERS.md [supabase].
        */}
        <div className="mt-8 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-soft)] p-3 text-xs text-gray-600">
          <p className="font-extrabold text-[var(--brand-900)]">
            Mock test credentials
          </p>
          <ul className="mt-2 grid gap-1">
            <li><code>driver@test</code></li>
            <li><code>dispatcher@test</code></li>
            <li><code>admin@test</code></li>
          </ul>
          <p className="mt-2">Shared password: <code>test1234</code></p>
        </div>
      </div>
    </main>
  );
}
