export default function PickupNotFound() {
  return (
    <main className="auth-page">
      <div className="auth-card mx-auto w-full max-w-md p-6 text-center">
        <span className="brand-mark mx-auto" aria-hidden="true" />
        <h1 className="mt-6 text-3xl font-black tracking-tight">
          Unknown pickup link
        </h1>
        <p className="mt-4 text-sm leading-6 text-gray-600">
          This link isn&apos;t recognized. Check with the lab for a new one.
        </p>
      </div>
    </main>
  );
}
