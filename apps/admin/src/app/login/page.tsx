import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { adminCopy } from "@/lib/copy";
import { hasAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasAdminSession()) {
    redirect("/moderacao");
  }
  return (
    <main className="mx-auto flex w-full max-w-sm flex-col gap-6 px-4 py-24">
      <h1 className="text-2xl font-black tracking-tight">{adminCopy.brand}</h1>
      <LoginForm />
      <p className="text-xs text-white/55">{adminCopy.boundary}</p>
    </main>
  );
}
