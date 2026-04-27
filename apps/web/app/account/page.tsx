"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowsClockwise,
  FloppyDisk,
  Key,
  User,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { avatarUrl, AVATAR_STYLES, type AvatarStyle } from "@/lib/avatar";

interface Profile {
  id: string;
  username: string;
  displayName: string | null;
  role: "user" | "admin";
  avatarSeed: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export default function AccountPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [avatarSeed, setAvatarSeed] = useState("");
  const [avatarStyle, setAvatarStyle] = useState<AvatarStyle>("lorelei");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    void fetch("/api/account/profile").then(async (res) => {
      if (!res.ok) return;
      const p = (await res.json()) as Profile;
      setProfile(p);
      setDisplayName(p.displayName ?? "");
      setAvatarSeed(p.avatarSeed);
    });
  }, []);

  if (!profile) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  async function saveProfile() {
    setSavingProfile(true);
    const res = await fetch("/api/account/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName, avatarSeed }),
    });
    setSavingProfile(false);
    if (!res.ok) {
      toast.error("保存失败");
      return;
    }
    toast.success("已保存");
    router.refresh();
  }

  async function savePassword() {
    if (newPassword.length < 8) {
      toast.error("新密码至少 8 位");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("两次输入的新密码不一致");
      return;
    }
    setSavingPassword(true);
    const res = await fetch("/api/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    setSavingPassword(false);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(j.error ?? "修改失败");
      return;
    }
    toast.success("密码已更新，请重新登录");
    setTimeout(() => router.push("/login"), 800);
  }

  return (
    <div className="max-w-3xl space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">账户</h1>
        <p className="text-sm text-muted-foreground mt-2">
          管理你的资料和登录凭据
        </p>
      </header>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-muted">
              <User className="h-4 w-4" weight="duotone" />
            </span>
            <div>
              <CardTitle className="text-base">个人资料</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                显示名和头像
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={avatarUrl(avatarSeed || profile.username, { style: avatarStyle, size: 96 })}
              width={64}
              height={64}
              alt="avatar"
              className="rounded-full bg-muted shrink-0"
            />
            <div className="space-y-2 flex-1">
              <div className="flex flex-wrap gap-1.5">
                {AVATAR_STYLES.map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={avatarStyle === s ? "default" : "outline"}
                    size="sm"
                    onClick={() => setAvatarStyle(s)}
                    className="h-7 text-xs"
                  >
                    {s}
                  </Button>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setAvatarSeed(Math.random().toString(36).slice(2, 12))
                }
              >
                <ArrowsClockwise className="h-3 w-3" weight="bold" />
                换个种子
              </Button>
            </div>
          </div>

          <Separator />

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">用户名</Label>
              <Input id="username" value={profile.username} disabled />
              <p className="text-[11px] text-muted-foreground">用户名不可更改</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="displayName">显示名</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={profile.username}
                maxLength={64}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="avatarSeed">头像种子</Label>
            <Input
              id="avatarSeed"
              value={avatarSeed}
              onChange={(e) => setAvatarSeed(e.target.value)}
              placeholder={profile.username}
              maxLength={64}
              className="font-mono"
            />
            <p className="text-[11px] text-muted-foreground">
              头像由 DiceBear 根据这个种子生成。换个字符串就换一张。
            </p>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveProfile} disabled={savingProfile}>
              <FloppyDisk className="h-4 w-4" weight="bold" />
              {savingProfile ? "保存中..." : "保存资料"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-md bg-muted">
              <Key className="h-4 w-4" weight="duotone" />
            </span>
            <div>
              <CardTitle className="text-base">修改密码</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                修改密码后会强制登出，需要用新密码重新登录
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">当前密码</Label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">新密码</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">确认新密码</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button
              onClick={savePassword}
              disabled={savingPassword || !currentPassword || !newPassword}
            >
              <Key className="h-4 w-4" weight="bold" />
              {savingPassword ? "更新中..." : "更新密码"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
