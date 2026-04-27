"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function VerifyEmailPage() {
  const router = useRouter();
  const params = useParams<{ token: string }>();
  const [status, setStatus] = useState<"pending" | "ok" | "fail">("pending");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    void fetch(`/api/auth/verify-email/${params.token}`, { method: "POST" }).then(async (res) => {
      const j = (await res.json().catch(() => ({}))) as { error?: string; email?: string };
      if (res.ok) {
        setStatus("ok");
        setMessage(j.email ?? "");
      } else {
        setStatus("fail");
        setMessage(j.error ?? "验证失败");
      }
    });
  }, [params.token]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-md text-center">
        <CardHeader>
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            {status === "ok" ? (
              <>
                <CheckCircle className="h-5 w-5 text-success" weight="duotone" />
                邮箱已验证
              </>
            ) : status === "fail" ? (
              <>
                <Warning className="h-5 w-5 text-destructive" weight="duotone" />
                验证失败
              </>
            ) : (
              "正在验证..."
            )}
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => router.push("/")}>返回首页</Button>
        </CardContent>
      </Card>
    </div>
  );
}
