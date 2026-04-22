import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default function AdminPage() {
  const session = getSession();
  if (!session || session.role !== "admin") {
    redirect("/login");
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
      <p className="text-gray-700">Hello, admin {session.userId}</p>
      <nav className="flex gap-4 text-sm">
        <a href="/driver" className="text-blue-600 hover:underline">
          Driver tree
        </a>
        <a href="/dispatcher" className="text-blue-600 hover:underline">
          Dispatcher tree
        </a>
        <a href="/admin" className="text-blue-600 hover:underline">
          Admin tree
        </a>
      </nav>
      <a href="/logout" className="text-sm text-blue-600 hover:underline">
        Log out
      </a>
    </main>
  );
}
