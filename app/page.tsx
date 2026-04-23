import Link from "next/link";
import { redirect } from "next/navigation";
import { landingPathFor } from "@/lib/auth-rules";
import { getSession } from "@/lib/session";

export default async function Page() {
  const session = await getSession();
  if (session) {
    redirect(landingPathFor(session.role));
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-bold tracking-tight">Lab Dispatch</h1>
      <p className="mt-4 text-lg text-gray-600">
        Coordinating sample pickups between doctors&apos; offices and the lab.
      </p>
      <Link
        href="/login"
        className="mt-6 text-sm font-medium text-blue-600 hover:underline"
      >
        Sign in
      </Link>
    </main>
  );
}
