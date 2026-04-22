import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default function DriverPage() {
  const session = getSession();
  if (!session || session.role !== "driver") {
    redirect("/login");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Driver</h1>
      <p className="text-gray-700">Hello, driver {session.userId}</p>
      <a href="/logout" className="text-sm text-blue-600 hover:underline">
        Log out
      </a>
    </main>
  );
}
