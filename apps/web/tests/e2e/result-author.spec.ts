import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type APIRequestContext } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../../..");

const user = {
  username: `rwres_${Date.now().toString(36).slice(-5)}`,
  password: "RwResultE2E123!",
  displayName: "RW Result E2E",
};

const FIXTURES = [
  {
    label: "retracted-refs",
    file: path.join(REPO_ROOT, "exam/exam_retracted_refs.tex"),
    expect: { verdict: "FAIL" as const, refsConfirmedMin: 3, authorsHitMax: 0 },
  },
  {
    label: "retracted-author",
    file: path.join(REPO_ROOT, "exam/exam_retracted_author.tex"),
    expect: { verdict: "REVIEW" as const, refsConfirmedMin: 0, authorsHitMin: 2 },
  },
  {
    label: "clean-control",
    file: path.join(REPO_ROOT, "exam/exam_clean_control.tex"),
    expect: { verdict: "PASS" as const, refsConfirmedMin: 0, authorsHitMax: 0 },
  },
];

test.describe.configure({ mode: "serial" });

async function uploadAndParse(api: APIRequestContext, fixturePath: string): Promise<string> {
  const fileBuffer = await import("node:fs").then((fs) => fs.readFileSync(fixturePath));
  const fileName = path.basename(fixturePath);
  const upload = await api.post("/api/upload", {
    multipart: {
      file: { name: fileName, mimeType: "application/x-tex", buffer: fileBuffer },
    },
  });
  expect(upload.status(), `upload ${fileName}`).toBe(200);
  const body = (await upload.json()) as { manuscriptId: string; deduped?: boolean };
  if (!body.deduped) {
    const start = await api.post("/api/parse/start", {
      data: { manuscriptId: body.manuscriptId },
    });
    expect(start.status(), `parse/start ${fileName}`).toBe(200);
  }
  // Poll /api/result until 200 (parse done)
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const res = await api.get(`/api/result/${body.manuscriptId}`);
    if (res.status() === 200) return body.manuscriptId;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${fileName}`);
}

test.beforeAll(async ({ request }) => {
  const created = await request.post("/api/auth/register", { data: user });
  expect([200, 409]).toContain(created.status());
});

for (const fixture of FIXTURES) {
  test(`fixture: ${fixture.label}`, async ({ page }) => {
    // Log in via UI; subsequent fetch through page.context().request reuses
    // the session cookie set by the login response.
    await page.goto("/login");
    await page.getByLabel("用户名").fill(user.username);
    await page.getByLabel("密码").fill(user.password);
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page).toHaveURL("/");

    const apiCtx = page.context().request;
    const id = await uploadAndParse(apiCtx, fixture.file);

    // Visit the result page and screenshot key sections.
    await page.goto(`/result/${id}`);
    await expect(page.getByText("verdict", { exact: false })).toBeTruthy();

    // Verdict badge
    const verdictBadge = page.getByText(fixture.expect.verdict, { exact: true }).first();
    await expect(verdictBadge).toBeVisible();

    // Author roster card present
    await expect(page.getByText("稿件作者")).toBeVisible();

    // For hit fixtures, the AuthorSummaryCard shows hit count > 0
    if (
      typeof fixture.expect.authorsHitMin === "number" &&
      fixture.expect.authorsHitMin > 0
    ) {
      await expect(page.getByText("作者撤稿史比对")).toBeVisible();
      // Click the first hit chip to expand the detail card
      const reviewChip = page.getByText("建议复核").first();
      const confirmedChip = page.getByText("涉及撤稿史").first();
      const targetChip = (await confirmedChip.count()) > 0 ? confirmedChip : reviewChip;
      await targetChip.click();
      // Expect the rewritten headline banner to be visible after expansion
      await expect(
        page.getByText(
          /Retraction Watch 库的撤稿记录|疑似匹配 Retraction Watch/,
        ).first(),
      ).toBeVisible();
    }

    // Clean control should show "已比对" pill and not the hit headlines
    if (fixture.expect.verdict === "PASS") {
      await expect(page.getByText("已比对").first()).toBeVisible();
    }

    // Capture screenshot for visual review
    const shotPath = path.join(
      REPO_ROOT,
      `apps/web/tests/e2e/__screenshots__/${fixture.label}.png`,
    );
    await page.screenshot({ path: shotPath, fullPage: true });
  });
}
