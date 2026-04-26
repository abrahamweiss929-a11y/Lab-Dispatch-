import { notFound } from "next/navigation";
import { getServices } from "@/interfaces";
import { parseSlugToken } from "@/lib/parse-slug-token";
import { PickupRequestForm } from "./_components/PickupRequestForm";

interface PickupPageProps {
  params: { slugToken: string };
}

// This route is intentionally PUBLIC — see PUBLIC_PATH_PREFIXES in
// `lib/auth-rules.ts`. Do not add a session check here; the rate limiter
// in the server action is the only abuse guard.
export default async function PickupPage({ params }: PickupPageProps) {
  const parsed = parseSlugToken(params.slugToken);
  if (parsed === null) {
    notFound();
  }
  const office = await getServices().storage.findOfficeBySlugToken(
    parsed.slug,
    parsed.token,
  );
  if (office === null) {
    notFound();
  }

  return (
    <main className="auth-page">
      <div className="route-visual" aria-hidden="true">
        <span className="route-line route-line-one" />
        <span className="route-line route-line-two" />
        <span className="route-node route-node-a" />
        <span className="route-node route-node-b" />
        <span className="route-node route-node-c" />
      </div>
      <div className="relative mx-auto w-full max-w-xl">
        <PickupRequestForm
          slugToken={params.slugToken}
          officeName={office.name}
          officeCity={office.address.city}
          officeState={office.address.state}
          officePhone={office.phone}
        />
      </div>
    </main>
  );
}
