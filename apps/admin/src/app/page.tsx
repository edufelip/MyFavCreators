import { redirect } from "next/navigation";
import { hasAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdminHomePage() {
  redirect((await hasAdminSession()) ? "/moderacao" : "/login");
}
