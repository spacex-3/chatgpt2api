import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStoredAuthSession,
  parseStoredAuthSessionValue,
  serializeStoredAuthSession,
} from "./auth-storage.ts";

test("normalizeStoredAuthSession trims values and fills defaults", () => {
  const session = normalizeStoredAuthSession({
    key: "  token-1  ",
    role: "user",
    subjectId: "",
    name: "",
  });

  assert.deepEqual(session, {
    key: "token-1",
    role: "user",
    subjectId: "upstream-admin",
    name: "图片用户",
  });
});

test("normalizeStoredAuthSession can fall back to separately stored key", () => {
  const session = normalizeStoredAuthSession({
    role: "admin",
    subjectId: "admin",
    name: "系统管理员",
  }, "fallback-token");

  assert.deepEqual(session, {
    key: "fallback-token",
    role: "admin",
    subjectId: "admin",
    name: "系统管理员",
  });
});

test("parseStoredAuthSessionValue safely handles invalid JSON", () => {
  assert.equal(parseStoredAuthSessionValue(""), null);
  assert.equal(parseStoredAuthSessionValue("{bad json"), null);
  assert.deepEqual(parseStoredAuthSessionValue('{"key":"token-1"}'), { key: "token-1" });
});

test("serializeStoredAuthSession produces JSON payload for localStorage mirror", () => {
  const payload = serializeStoredAuthSession({
    key: "token-1",
    role: "user",
    subjectId: "subject-1",
    name: "图片用户",
  });

  assert.equal(typeof payload, "string");
  assert.deepEqual(JSON.parse(payload), {
    key: "token-1",
    role: "user",
    subjectId: "subject-1",
    name: "图片用户",
  });
});
