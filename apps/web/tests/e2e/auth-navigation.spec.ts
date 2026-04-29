import { expect, test } from "@playwright/test";

const admin = {
  username: "e2eadmin",
  password: "CodexE2E123",
  displayName: "E2E Admin",
};

const user = {
  username: "e2euser",
  password: "CodexUser123",
  displayName: "E2E User",
};

test.describe.configure({ mode: "serial" });

test("public pages, auth guards, and first admin registration work", async ({
  page,
  request,
}) => {
  await page.goto("/login");
  await expect(page.getByLabel("用户名")).toBeVisible();
  await expect(page.getByRole("button", { name: "登录" })).toBeVisible();

  await page.goto("/register");
  await expect(page.getByRole("button", { name: "创建账户" })).toBeVisible();

  await page.goto("/forgot");
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送重置链接" })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);

  const dashboard = await request.get("/api/dashboard");
  expect(dashboard.status()).toBe(401);

  const weak = await request.post("/api/auth/register", {
    data: { username: "e2eweak", password: "short", displayName: "Weak User" },
  });
  expect(weak.status()).toBe(400);
  await expect(await weak.json()).toMatchObject({ error: "密码至少 8 位" });

  const created = await request.post("/api/auth/register", { data: admin });
  expect(created.status()).toBe(200);
  await expect(await created.json()).toMatchObject({
    user: { username: admin.username, role: "admin" },
  });
});

test("login form rejects bad credentials and opens the dashboard for admin", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(admin.username);
  await page.getByLabel("密码").fill("wrong-password");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByText("用户名或密码错误")).toBeVisible();

  await page.getByLabel("密码").fill(admin.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: `你好，${admin.displayName}` })).toBeVisible();
  await expect(page.getByText("拖拽文件到此处")).toBeVisible();
});

test("admin can load protected pages and core APIs", async ({ baseURL, page, playwright }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill(admin.username);
  await page.getByLabel("密码").fill(admin.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/");

  const pages = [
    ["/history", "历史记录"],
    ["/settings", "设置"],
    ["/workspaces", "团队空间"],
    ["/account", "账户"],
    ["/admin", "管理员"],
    ["/admin/analytics", "解析日志分析"],
  ] as const;

  for (const [url, heading] of pages) {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  const api = await playwright.request.newContext({ baseURL });
  const login = await api.post("/api/auth/login", {
    data: { username: admin.username, password: admin.password },
  });
  expect(login.status()).toBe(200);

  for (const url of [
    "/api/auth/me",
    "/api/dashboard",
    "/api/manuscripts",
    "/api/projects",
    "/api/workspaces",
    "/api/admin/users",
    "/api/admin/analytics?limit=5",
    "/api/account/screening-logs/stats",
  ]) {
    const response = await api.get(url);
    expect(response.status(), url).toBe(200);
  }

  await api.dispose();
});

test("normal users are registered as non-admins and cannot access admin APIs", async ({
  baseURL,
  page,
  playwright,
}) => {
  const api = await playwright.request.newContext({ baseURL });
  const created = await api.post("/api/auth/register", { data: user });
  expect(created.status()).toBe(200);
  await expect(await created.json()).toMatchObject({
    user: { username: user.username, role: "user" },
  });

  const forbidden = await api.get("/api/admin/users");
  expect(forbidden.status()).toBe(403);
  await api.dispose();

  await page.goto("/login");
  await page.getByLabel("用户名").fill(user.username);
  await page.getByLabel("密码").fill(user.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/admin");
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: `你好，${user.displayName}` })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理", exact: true })).toHaveCount(0);
});
