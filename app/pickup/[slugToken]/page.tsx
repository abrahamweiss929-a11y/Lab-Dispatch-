import { notFound } from "next/navigation";
import { getServices } from "@/interfaces";
import { isValidSlugTokenSegment } from "@/lib/parse-slug-token";
import { PickupRequestForm } from "./_components/PickupRequestForm";

interface PickupPageProps {
  params: { slugToken: string };
}

// This route is intentionally PUBLIC — see PUBLIC_PATH_PREFIXES in
// `lib/auth-rules.ts`. Do not add a session check here; the rate limiter
// in the server action is the only abuse guard.
export default async function PickupPage({ params }: PickupPageProps) {
  if (!isValidSlugTokenSegment(params.slugToken)) {
    notFound();
  }
  // Composite-match lookup: avoids the broken split-on-hyphen path. Both
  // slug and token may contain hyphens, so the only way to find the
  // matching office is to compare `slug + '-' + pickupUrlToken` against
  // the full URL segment.
  const office = await getServices().storage.findOfficeByPickupUrlSegment(
    params.slugToken,
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
