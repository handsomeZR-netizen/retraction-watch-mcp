"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CaretDown,
  ClockCounterClockwise,
  Gear,
  IdentificationCard,
  ShieldStar,
  SignOut,
  User,
} from "@phosphor-icons/react";
import { avatarUrl } from "@/lib/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Me {
  id: string;
  username: string;
  displayName: string | null;
  role: "user" | "admin";
  avatarSeed?: string;
}

export function UserMenu() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    void fetch("/api/auth/me").then(async (res) => {
      if (!res.ok) return;
      const j = (await res.json()) as { user: Me | null };
      if (!j.user) return;
      setMe(j.user);
      const profileRes = await fetch("/api/account/profile");
      if (profileRes.ok) {
        const p = (await profileRes.json()) as { avatarSeed?: string };
        setMe((prev) => (prev ? { ...prev, avatarSeed: p.avatarSeed ?? prev.username } : prev));
      }
    });
  }, []);

  if (!me) return null;

  const seed = me.avatarSeed ?? me.username;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 px-2 h-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={avatarUrl(seed, { size: 48 })}
            alt=""
            width={24}
            height={24}
            className="rounded-full bg-muted"
          />
          <span className="text-sm hidden sm:inline">{me.displayName ?? me.username}</span>
          <CaretDown className="h-3 w-3 text-muted-foreground" weight="bold" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex items-center gap-2">
          <User className="h-4 w-4" weight="duotone" />
          <div className="min-w-0">
            <div className="truncate font-medium">{me.displayName ?? me.username}</div>
            <div className="truncate text-xs text-muted-foreground font-normal">
              {me.role === "admin" ? "管理员" : "用户"} · {me.username}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <IdentificationCard className="h-4 w-4" weight="duotone" />
            账户
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/history">
            <ClockCounterClockwise className="h-4 w-4" weight="duotone" />
            历史记录
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Gear className="h-4 w-4" weight="duotone" />
            设置
          </Link>
        </DropdownMenuItem>
        {me.role === "admin" && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <ShieldStar className="h-4 w-4" weight="duotone" />
              管理员
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={logout} className="text-destructive focus:text-destructive">
          <SignOut className="h-4 w-4" weight="bold" />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
