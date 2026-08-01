(() => {
  const SESSION_KEY = "kinecheck_secure_session_v1";
  const HANDOFF_TYPE = "kinecheck-sso-v2";
  const MAX_AGE_MS = 120000;

  function validSession(session) {
    return Boolean(session?.access_token && session?.refresh_token);
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
      return handoff.session;
    } catch {
      return null;
    } finally {
      window.name = "";
    }
  }

  function sessionFromHash() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const encoded = params.get("kc_session");
    if (!encoded) return null;
    try {
      const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
      const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const session = JSON.parse(new TextDecoder().decode(bytes));
      return validSession(session) ? session : null;
    } catch {
      return null;
    }
  }

  const session = sessionFromWindowName() || sessionFromHash();
  if (session) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.__KINECHECK_SSO_RECEIVED__ = true;
  }

  if (location.hash.includes("kc_session=")) {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
})();
