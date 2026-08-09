import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const SOURCE = fs.readFileSync(new URL("../sso-handoff.js", import.meta.url), "utf8");
const SESSION_KEY = "kinecheck_course_session_v2:mas-alla-del-dolor";
const PRODUCT = "mas-alla-del-dolor";

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function encodedHandoff(overrides = {}) {
  const payload = {
    type: "kinecheck-sso-v3-access-only",
    issuedAt: Date.now(),
    product: PRODUCT,
    session: {
      access_token: "fresh-private-access-token-1234567890",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: "bearer",
      refresh_token: "NO-DEBE-PERSISTIR",
      email: "no-debe-persistir@example.com",
    },
    ...overrides,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function runReceiver(encoded) {
  const sessionStorage = storage();
  const localStorage = storage();
  let cleanedUrl = "";
  const location = {
    hash: `#kc_handoff=${encoded}`,
    pathname: "/mas-alla-del-dolor/",
    search: "?course=mas-alla-del-dolor",
  };
  const window = {
    location,
    history: {
      state: null,
      replaceState(_state, _title, url) { cleanedUrl = String(url); },
    },
    name: "",
    opener: null,
    dispatchEvent() {},
  };

  vm.runInNewContext(SOURCE, {
    window,
    sessionStorage,
    localStorage,
    URLSearchParams,
    TextDecoder,
    Uint8Array,
    Buffer,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  });

  return { sessionStorage, localStorage, cleanedUrl };
}

test("una sesión privada fresca se consume desde el fragmento y se limpia de la URL", () => {
  const { sessionStorage, localStorage, cleanedUrl } = runReceiver(encodedHandoff());
  const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY));

  assert.equal(saved.product, PRODUCT);
  assert.equal(saved.access_token, "fresh-private-access-token-1234567890");
  assert.equal(saved.handoff_access_only, true);
  assert.equal(saved.refresh_token, undefined);
  assert.equal(saved.email, undefined);
  assert.equal(localStorage.getItem(SESSION_KEY), null);
  assert.equal(cleanedUrl, "/mas-alla-del-dolor/?course=mas-alla-del-dolor");
  assert.ok(!cleanedUrl.includes("kc_handoff"));
});

test("un handoff vencido no crea sesión y también se retira de la URL", () => {
  const issuedAt = Date.now() - 180000;
  const { sessionStorage, cleanedUrl } = runReceiver(encodedHandoff({ issuedAt }));

  assert.equal(sessionStorage.getItem(SESSION_KEY), null);
  assert.ok(!cleanedUrl.includes("kc_handoff"));
});
