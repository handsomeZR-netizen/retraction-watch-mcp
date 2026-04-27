import { redirect } from "next/navigation";
import { ShieldStar } from "@phosphor-icons/react/dist/ssr";
import { getCurrentUser } from "@/lib/auth/session";
import { AdminUsersTable } from "./users-table";
import { AdminAuditList } from "./audit-list";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login?redirect=/admin");
  if (me.role !== "admin") redirect("/");

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight">
          <ShieldStar className="h-7 w-7" weight="duotone" />
          管理员
        </h1>
        <p className="text-sm text-muted-foreground">
          查看所有用户、禁用账户、查阅审计日志。
        </p>
      </header>
      <AdminUsersTable />
      <AdminAuditList />
    </div>
  );
}
