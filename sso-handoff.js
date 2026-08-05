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
    const now = Math.floor(Date.now() / 1000);
    return !expiresAt || expiresAt > now + 30;
  }

  function normalizeHandoff(handoff) {
    const issuedAt = Number(handoff?.issuedAt);
    const session = handoff?.session;
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

  function clearOldSessions() {
    try {
      localStorage.removeItem(LEGACY_SESSION_KEY);
      localStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // Limpieza de mejor esfuerzo.
    }
  }

  function saveSession(session) {
    clearOldSessions();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.__KINECHECK_SSO_RECEIVED__ = true;
  }

  function notifyAccepted(targetOrigin = "*") {
    if (!window.opener) return;
    try {
      window.opener.postMessage({
        type: ACCEPTED_TYPE,
        product: EXPECTED_PRODUCT,
      }, targetOrigin);
    } catch {
      // La sesión ya quedó guardada; la notificación solo cierra el intercambio.
    }
  }

  function sessionFromWindowName() {
    if (!window.name) return null;
    try {
      return normalizeHandoff(JSON.parse(window.name));
    } catch {
      return null;
    } finally {
      window.name = "";
    }
  }

  const directSession = sessionFromWindowName();
  if (directSession) {
    saveSession(directSession);
    notifyAccepted();
    return;
  }

  if (!window.opener) {
    clearOldSessions();
    return;
  }

  clearOldSessions();
  let completed = false;

  const finish = () => {
    window.removeEventListener("message", onMessage);
    window.clearTimeout(timeoutId);
  };

  const onMessage = (event) => {
    if (
      completed
      || event.source !== window.opener
      || !ALLOWED_ACADEMY_ORIGINS.has(event.origin)
    ) return;

    const session = normalizeHandoff(event.data);
    if (!session) return;

    completed = true;
    saveSession(session);
    notifyAccepted(event.origin);
    finish();
    location.reload();
  };

  window.addEventListener("message", onMessage);
  const timeoutId = window.setTimeout(finish, 10000);

  try {
    window.opener.postMessage({
      type: READY_TYPE,
      product: EXPECTED_PRODUCT,
    }, "*");
  } catch {
    finish();
  }
})();
