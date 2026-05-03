import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutoLoginSignature,
  hasSettingsAutoLoginHint,
  parseSettingsAutoLoginCredentials,
  resolveHomePageRedirectPath,
  resolveLoginPageState,
  stripSettingsFromRoute,
} from "./login-settings.ts";

test("parseSettingsAutoLoginCredentials extracts api key and base url", () => {
  const credentials = parseSettingsAutoLoginCredentials(
    JSON.stringify({
      keyVaults: {
        openai: {
          apiKey: "  sk-test  ",
          baseURL: "https://newapi.example.com/v1/",
        },
      },
    }),
  );

  assert.deepEqual(credentials, {
    upstreamApiKey: "sk-test",
    upstreamApiUrl: "https://newapi.example.com/v1",
  });
});

test("parseSettingsAutoLoginCredentials rejects invalid payloads", () => {
  assert.equal(parseSettingsAutoLoginCredentials(""), null);
  assert.equal(parseSettingsAutoLoginCredentials("{bad json"), null);
  assert.equal(
    parseSettingsAutoLoginCredentials(JSON.stringify({ keyVaults: { openai: { apiKey: "sk-test" } } })),
    null,
  );
  assert.equal(
    parseSettingsAutoLoginCredentials(JSON.stringify({ keyVaults: { openai: { apiKey: "sk-test", baseURL: "ftp://bad" } } })),
    null,
  );
});

test("stripSettingsFromRoute removes sensitive settings but keeps other query params", () => {
  assert.equal(
    stripSettingsFromRoute('/image?settings={"keyVaults":{"openai":{"apiKey":"sk","baseURL":"https://a.com/v1"}}}&foo=bar#hash'),
    "/image?foo=bar#hash",
  );
  assert.equal(stripSettingsFromRoute("https://evil.example.com"), "");
});

test("resolveLoginPageState reads direct settings and defaults nextRoute to empty", () => {
  const state = resolveLoginPageState(
    `?settings=${encodeURIComponent('{"keyVaults":{"openai":{"apiKey":"sk-direct","baseURL":"https://direct.example.com/v1"}}}')}`,
  );

  assert.equal(state.nextRoute, "");
  assert.equal(state.hasAutoLoginHint, true);
  assert.deepEqual(state.autoLoginCredentials, {
    upstreamApiKey: "sk-direct",
    upstreamApiUrl: "https://direct.example.com/v1",
  });
});

test("resolveLoginPageState extracts settings from next and strips them from redirect route", () => {
  const nextRoute = '/image?settings={"keyVaults":{"openai":{"apiKey":"sk-next","baseURL":"https://next.example.com/v1"}}}&foo=bar';
  const state = resolveLoginPageState(`?next=${encodeURIComponent(nextRoute)}`);

  assert.equal(state.nextRoute, "/image?foo=bar");
  assert.equal(state.hasAutoLoginHint, true);
  assert.deepEqual(state.autoLoginCredentials, {
    upstreamApiKey: "sk-next",
    upstreamApiUrl: "https://next.example.com/v1",
  });
});

test("hasSettingsAutoLoginHint detects direct and nested settings params", () => {
  assert.equal(hasSettingsAutoLoginHint("?settings=%7B%7D"), true);
  assert.equal(hasSettingsAutoLoginHint(`?next=${encodeURIComponent("/image?settings=%7B%7D")}`), true);
  assert.equal(hasSettingsAutoLoginHint("?foo=bar"), false);
});

test("resolveHomePageRedirectPath ignores existing admin session when settings auto-login is requested", () => {
  const search = `?settings=${encodeURIComponent('{"keyVaults":{"openai":{"apiKey":"sk-direct","baseURL":"https://direct.example.com/v1"}}}')}`;

  assert.equal(
    resolveHomePageRedirectPath(search, "admin"),
    `/login?next=${encodeURIComponent(`/image${search}`)}`,
  );
});

test("resolveHomePageRedirectPath preserves default session redirect when no settings are present", () => {
  assert.equal(resolveHomePageRedirectPath("", "admin"), "/admin");
  assert.equal(resolveHomePageRedirectPath("", "user"), "/image");
  assert.equal(resolveHomePageRedirectPath("?foo=bar", null), `/login?next=${encodeURIComponent("/image?foo=bar")}`);
});

test("buildAutoLoginSignature is stable for equivalent credentials", () => {
  const signatureA = buildAutoLoginSignature({
    upstreamApiKey: "sk-test",
    upstreamApiUrl: "https://example.com/v1",
  }, "/image");
  const signatureB = buildAutoLoginSignature({
    upstreamApiKey: "sk-test",
    upstreamApiUrl: "https://example.com/v1",
  }, "/image");

  assert.equal(signatureA, "https://example.com/v1\nsk-test\n/image");
  assert.equal(signatureA, signatureB);
  assert.equal(buildAutoLoginSignature(null, "/image"), "");
});
