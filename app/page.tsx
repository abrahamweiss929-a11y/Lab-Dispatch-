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
    <main className="hero-scene flex items-center px-6 py-12">
      <div className="route-visual" aria-hidden="true">
        <span className="route-line route-line-one" />
        <span className="route-line route-line-two" />
        <span className="route-node route-node-a" />
        <span className="route-node route-node-b" />
        <span className="route-node route-node-c" />
      </div>
      <section className="relative mx-auto w-full max-w-5xl">
        <div className="brand-lockup brand-inverse">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="brand-title text-xl">Lab Dispatch</p>
            <p className="brand-subtitle">Specimen logistics</p>
          </div>
        </div>

        <h1 className="mt-10 max-w-3xl text-5xl font-black leading-[0.96] sm:text-7xl">
          Lab Dispatch
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-white/72">
          Coordinating sample pickups between doctors&apos; offices, dispatchers,
          drivers, and the lab in one calm, visual workspace.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/login" className="btn bg-white text-[var(--brand-950)] hover:bg-teal-50">
            Sign in
          </Link>
          <Link href="/login?next=/dispatcher" className="btn border border-white/15 bg-white/10 text-white hover:bg-white/15">
            Dispatcher console
          </Link>
        </div>
      </section>
    </main>
  );
}
