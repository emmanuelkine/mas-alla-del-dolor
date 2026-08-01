(() => {
  const SESSION_KEY = "kinecheck_secure_session_v1";
  const HANDOFF_TYPE = "kinecheck-sso-v3-access-only";
  const MAX_AGE_MS = 120000;

  function validSession(session) {
    return Boolean(session?.access_token);
  }

  function sessionFromWindowName() {
    if (!window.name) return null;
    try {
      const handoff = JSON.parse(window.name);
      if (
        handoff?.type !== HANDOFF_TYPE
        || !Number.isFinite(Number(handoff.issuedAt))
        || Math.abs(Date.now() - Number(handoff.issuedAt)) > MAX_AGE_MS
        || !validSession(handoff.session)
      ) return null;
      return { ...handoff.session, handoff_access_only: true };
    } catch {
      return null;
    } finally {
      window.name = "";
    }
  }

  const session = sessionFromWindowName();
  if (!session) return;

  localStorage.removeItem(SESSION_KEY);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  window.__KINECHECK_SSO_RECEIVED__ = true;
})();
