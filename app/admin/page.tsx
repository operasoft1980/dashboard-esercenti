import { redirect } from "next/navigation";
import { isAdminRequest } from "@/lib/adminSession";
import AdminClient from "./admin-client";

export const metadata = {
  title: "Admin — Recensioni a 5 Stelle",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  if (!(await isAdminRequest())) {
    redirect("/admin/login");
  }
  return <AdminClient />;
}
