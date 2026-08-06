(() => {
  "use strict";

  const SESSION_KEY = "kinecheck_course_session_v2:mas-alla-del-dolor";
  const LEGACY_SESSION_KEY = "kinecheck_course_session_v1:mas-alla-del-dolor";
  const HANDOFF_TYPE = "kinecheck-sso-v3-access-only";
  const READY_TYPE = "kinecheck-sso-ready";
  const ACCEPTED_TYPE = "kinecheck-sso-accepted";
  const EXPECTED_PRODUCT = "mas-alla-del-dolor";
  const MAX_AGE_MS = 120000;
  const ALLOWED_ACADEMY_ORIGINS = new Set([
    "https://kinecheck-comunicacion-clinica.pages.dev",
    "https://emmanuelkine.github.io",
    "https://kinecheck.cl",
    "https://www.kinecheck.cl",
  ]);

  function validSession(session) {
    if (!session?.access_token) return false;
    const expiresAt = Number(session.expires_at || 0);
    return !expiresAt || expiresAt > Math.floor(Date.now() / 1000) + 20;
  }

  function normalizeHandoff(handoff) {
    const issuedAt = Number(handoff?.issuedAt);
    const session = handoff?.session?.access_token ? handoff.session : handoff;
    if (
      handoff?.type !== HANDOFF_TYPE
      || handoff?.product !== EXPECTED_PRODUCT
      || !Number.isFinite(issuedAt)
      || Math.abs(Date.now() - issuedAt) > MAX_AGE_MS
      || !validSession(session)
    ) return null;

    return {
      access_token: String(session.access_token),
      expires_at: Number(session.expires_at || 0) || null,
      expires_in: Number(session.expires_in || 0) || null,
      token_type: session.token_type || "bearer",
      handoff_access_only: true,
      product: EXPECTED_PRODUCT,
    };
  }

  function saveSession(session) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(LEGACY_SESSION_KEY);
      window.__KINECHECK_SSO_RECEIVED__ = true;
      window.dispatchEvent(new CustomEvent("kinecheck:sso-received", { detail: { product: EXPECTED_PRODUCT } }));
    } catch {
      // La transferencia por postMessage puede volver a intentarse.
    }
  }

  function notifyAccepted(origin = "*") {
    if (!window.opener) return;
    try {
      window.opener.postMessage({ type: ACCEPTED_TYPE, product: EXPECTED_PRODUCT }, origin);
    } catch {
      // La sesión ya fue guardada.
    }
  }

  function readWindowName() {
    if (!window.name) return null;
    try {
      return normalizeHandoff(JSON.parse(window.name));
    } catch {
      return null;
    } finally {
      window.name = "";
    }
  }

  const direct = readWindowName();
  if (direct) {
    saveSession(direct);
    notifyAccepted();
  }

  if (!window.opener) return;

  let completed = Boolean(direct);
  const onMessage = (event) => {
    if (completed || event.source !== window.opener || !ALLOWED_ACADEMY_ORIGINS.has(event.origin)) return;
    const session = normalizeHandoff(event.data);
    if (!session) return;
    completed = true;
    saveSession(session);
    notifyAccepted(event.origin);
    window.removeEventListener("message", onMessage);
  };

  window.addEventListener("message", onMessage);
  try {
    window.opener.postMessage({ type: READY_TYPE, product: EXPECTED_PRODUCT }, "*");
  } catch {
    window.removeEventListener("message", onMessage);
  }

  window.setTimeout(() => window.removeEventListener("message", onMessage), 20000);
})();
