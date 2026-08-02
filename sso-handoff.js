(() => {
  const SESSION_KEY = "kinecheck_secure_session_v1";
  const HANDOFF_TYPE = "kinecheck-sso-v3-access-only";
  const READY_TYPE = "kinecheck-sso-ready";
  const EXPECTED_PRODUCT = "mas-alla-del-dolor";
  const MAX_AGE_MS = 120000;
  const ALLOWED_ACADEMY_ORIGINS = new Set([
    "https://kinecheck-comunicacion-clinica.pages.dev",
    "https://emmanuelkine.github.io",
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
      ...session,
      handoff_access_only: true,
    };
  }

  function saveSession(session) {
    localStorage.removeItem(SESSION_KEY);
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.__KINECHECK_SSO_RECEIVED__ = true;
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
    return;
  }

  if (!window.opener) return;

  // Al abrir desde Academy, la sesión actual siempre prevalece sobre
  // cualquier sesión antigua almacenada previamente en este dominio.
  localStorage.removeItem(SESSION_KEY);

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
