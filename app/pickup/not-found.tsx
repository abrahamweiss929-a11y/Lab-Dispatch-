export default function PickupNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-bold tracking-tight">
          Unknown pickup link
        </h1>
        <p className="mt-4 text-sm text-gray-600">
          This link isn&apos;t recognized. Check with the lab for a new one.
        </p>
      </div>
    </main>
  );
}
