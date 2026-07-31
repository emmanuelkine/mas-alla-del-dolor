(() => {
  const SESSION_KEY = "kinecheck_secure_session_v1";
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const encoded = params.get("kc_session");
  if (!encoded) return;

  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const session = JSON.parse(new TextDecoder().decode(bytes));

    if (!session?.access_token || !session?.refresh_token) {
      throw new Error("La sesión recibida no es válida.");
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (error) {
    console.error("KineCheck SSO", error);
  } finally {
    history.replaceState(null, "", `${location.pathname}${location.search}`);
  }
})();
