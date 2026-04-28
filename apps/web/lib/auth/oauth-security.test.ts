import { describe, expect, it } from "vitest";
import {
  authorizeUrl,
  parseOAuthState,
  safeLocalRedirect,
  type ProviderConfig,
} from "./oauth";

describe("OAuth state and redirect validation", () => {
  const config: ProviderConfig = {
    authorizeUrl: "https://provider.test/oauth/authorize",
    tokenUrl: "https://provider.test/oauth/token",
    userinfoUrl: "https://provider.test/userinfo",
    scope: "openid email",
    clientId: "client-id",
    clientSecret: "client-secret",
    parseUser: () => ({
      providerId: "provider-user",
      email: "user@example.com",
      emailVerified: true,
      username: "Provider User",
      avatarUrl: null,
    }),
  };

  it("rejects OAuth state mismatches", () => {
    expect(parseOAuthState("wrong-state:%2Fhistory", "expected-state")).toBeNull();
  });

  it("preserves valid local OAuth redirects", () => {
    expect(parseOAuthState("state:%2Fhistory%3Ftab%3Dmine", "state")).toEqual({
      redirect: "/history?tab=mine",
    });
  });

  it("drops external or protocol-relative OAuth redirects", () => {
    expect(safeLocalRedirect("https://evil.test/callback")).toBeNull();
    expect(safeLocalRedirect("//evil.test/callback")).toBeNull();

    const url = authorizeUrl(
      "google",
      config,
      "state",
      "http://rw.test/api/auth/oauth/google/callback",
      "https://evil.test/callback",
    );

    expect(new URL(url).searchParams.get("state")).toBe("state");
  });
});
