const CONFIG = window.KINECHECK_CONFIG || {};
const EXPECTED_COURSE = "mas-alla-del-dolor";
const SESSION_KEY = "kinecheck_course_session_v2:mas-alla-del-dolor";
const LEGACY_SESSION_KEY = "kinecheck_course_session_v1:mas-alla-del-dolor";
const $ = (selector) => document.querySelector(selector);

const elements = {
  shell: $("#access-shell"),
  root: $("#root"),
  message: $("#auth-message"),
  progress: $("#access-progress"),
  progressMessage: $("#progress-message"),
  ecosystemEntry: $("#ecosystem-entry"),
  signOut: $("#sign-out"),
};

function configuredCorrectly() {
  return Boolean(
    CONFIG.supabaseUrl
    && CONFIG.supabaseAnonKey
    && CONFIG.courseKeyFunction
    && CONFIG.courseSlug === EXPECTED_COURSE,
  );
}

function authHeaders(accessToken) {
  const headers = {
    apikey: CONFIG.supabaseAnonKey,
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

function normalizeSession(value) {
  if (!value?.access_token) return null;
  const expiresAt = Number(value.expires_at || 0);
  if (expiresAt && expiresAt <= Math.floor(Date.now() / 1000) + 15) return null;
  if (value.product && value.product !== EXPECTED_COURSE) return null;
  return {
    access_token: String(value.access_token),
    expires_at: expiresAt || null,
    expires_in: Number(value.expires_in || 0) || null,
    token_type: value.token_type || "bearer",
    handoff_access_only: true,
    product: EXPECTED_COURSE,
  };
}

function readJson(storage, key) {
  try {
    return normalizeSession(JSON.parse(storage.getItem(key) || "null"));
  } catch {
    return null;
  }
}

function clearSessions() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Limpieza de mejor esfuerzo.
  }
}

function readSession() {
  const temporary = readJson(sessionStorage, SESSION_KEY);
  if (temporary) return temporary;

  const legacy = readJson(localStorage, LEGACY_SESSION_KEY);
  if (!legacy) return null;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(legacy));
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // La sesión sigue siendo utilizable durante esta carga.
  }
  return legacy;
}

async function request(path, options = {}) {
  const response = await fetch(`${CONFIG.supabaseUrl}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      ...authHeaders(options.accessToken),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.message || data.error_description || data.msg || data.error || "Solicitud rechazada",
    );
    error.status = response.status;
    throw error;
  }
  return data;
}

function setBusy(visible, text = "Verificando tu licencia de Más allá del dolor…") {
  if (elements.progress) elements.progress.hidden = !visible;
  if (elements.progressMessage) elements.progressMessage.textContent = text;
}

function showMessage(text, error = false) {
  if (!elements.message) return;
  elements.message.textContent = text;
  elements.message.className = error ? "notice notice-error" : "notice";
  elements.message.hidden = false;
}

function showEcosystemEntry(text = "Inicia sesión una sola vez en KineCheck y abre este curso desde tu biblioteca.") {
  setBusy(false);
  if (elements.ecosystemEntry) {
    const copy = elements.ecosystemEntry.querySelector("p");
    if (copy) copy.textContent = text;
    elements.ecosystemEntry.hidden = false;
  }
  if (elements.shell) elements.shell.hidden = false;
  if (elements.root) elements.root.hidden = true;
  if (elements.signOut) elements.signOut.hidden = true;
}

async function validateIdentity(session) {
  const user = await request("/auth/v1/user", {
    method: "GET",
    accessToken: session.access_token,
  });
  return { ...session, user };
}

async function fetchCourseSource(accessToken) {
  const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${CONFIG.courseKeyFunction}`, {
    method: "POST",
    cache: "no-store",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ courseSlug: EXPECTED_COURSE }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(
      data.message || "Tu sesión está activa, pero esta cuenta no tiene una licencia de Más allá del dolor.",
    );
    error.status = response.status;
    throw error;
  }

  return response.text();
}

async function launchCourse(source, session) {
  if (!elements.root || !elements.shell) throw new Error("La pantalla del curso no está disponible.");
  elements.root.hidden = false;
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));

  try {
    await import(moduleUrl);
    elements.shell.hidden = true;
    if (elements.signOut) elements.signOut.hidden = false;
    window.dispatchEvent(new CustomEvent("kinecheck:course-authorized", {
      detail: { courseSlug: EXPECTED_COURSE, email: session.user?.email || "" },
    }));
  } catch (error) {
    elements.root.hidden = true;
    elements.shell.hidden = false;
    if (elements.signOut) elements.signOut.hidden = true;
    throw new Error(`El contenido no pudo iniciarse: ${error.message}`);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

async function authorizeAndLaunch(session) {
  setBusy(true);
  if (elements.message) elements.message.hidden = true;
  if (elements.ecosystemEntry) elements.ecosystemEntry.hidden = true;

  try {
    const verified = await validateIdentity(session);
    const source = await fetchCourseSource(verified.access_token);
    setBusy(true, "Preparando el curso protegido…");
    await launchCourse(source, verified);
  } catch (error) {
    clearSessions();
    setBusy(false);
    const denied = error.status === 403;
    showMessage(
      denied
        ? `${error.message} Solo se habilita el producto comprado por esta cuenta.`
        : `${error.message} Vuelve a KineCheck y abre el curso nuevamente.`,
      true,
    );
    showEcosystemEntry(
      denied
        ? "Esta cuenta no tiene una licencia activa de Más allá del dolor. Regresa a tu biblioteca para abrir únicamente tus productos disponibles."
        : "La sesión terminó. Regresa a KineCheck, inicia sesión una vez y vuelve a abrir el curso.",
    );
  }
}

elements.signOut?.addEventListener("click", () => {
  clearSessions();
  location.replace("https://kinecheck.cl/academy/#biblioteca");
});

(async function start() {
  if (!configuredCorrectly()) {
    showMessage("La configuración de acceso de este curso no coincide con el producto esperado.", true);
    showEcosystemEntry();
    return;
  }

  const session = readSession();
  if (!session) {
    showEcosystemEntry();
    return;
  }

  await authorizeAndLaunch(session);
})();
