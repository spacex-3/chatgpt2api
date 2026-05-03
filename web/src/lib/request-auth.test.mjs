import assert from "node:assert/strict";
import test from "node:test";

import { shouldReadStoredAuthKey } from "./request-auth.ts";

test("regular requests still read stored auth key by default", () => {
  assert.equal(shouldReadStoredAuthKey(), true);
  assert.equal(shouldReadStoredAuthKey({ withStoredAuthKey: true }), true);
});

test("login-like requests can explicitly skip stored auth key lookup", () => {
  assert.equal(shouldReadStoredAuthKey({ withStoredAuthKey: false }), false);
});

test("requests with explicit Authorization header do not need stored auth key lookup", () => {
  assert.equal(shouldReadStoredAuthKey({ hasAuthorizationHeader: true }), false);
  assert.equal(shouldReadStoredAuthKey({ withStoredAuthKey: true, hasAuthorizationHeader: true }), false);
});
