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
  ecosystemLink: $("#ecosystem-entry .ecosystem-entry-link"),
  retry: $("#ecosystem-entry .ecosystem-retry"),
  signOut: $("#sign-out"),
};
let starting = false;

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
  try { return normalizeSession(JSON.parse(storage.getItem(key) || "null")); }
  catch { return null; }
}

function clearSessions() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch { /* limpieza de mejor esfuerzo */ }
}

function readSession() {
  return readJson(sessionStorage, SESSION_KEY) || readJson(localStorage, LEGACY_SESSION_KEY);
}

async function waitForSession(timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const session = readSession();
    if (session) return session;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, cache: "no-store", signal: controller.signal });
  } catch (error) {
    const network = new Error(error?.name === "AbortError"
      ? "La conexión tardó demasiado. Intenta nuevamente."
      : "No pudimos conectar con KineCheck. Intenta nuevamente.");
    network.code = "NETWORK_ERROR";
    throw network;
  } finally {
    window.clearTimeout(timer);
  }
}

async function request(path, options = {}) {
  const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}${path}`, {
    ...options,
    headers: {
      ...authHeaders(options.accessToken),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || data.error_description || data.msg || data.error || "Solicitud rechazada");
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

function configureEntry({ copy, showLibrary = true, showRetry = false } = {}) {
  if (!elements.ecosystemEntry) return;
  const paragraph = elements.ecosystemEntry.querySelector("p");
  if (paragraph && copy) paragraph.textContent = copy;
  elements.ecosystemEntry.hidden = false;
  if (elements.ecosystemLink) {
    elements.ecosystemLink.hidden = !showLibrary;
    elements.ecosystemLink.textContent = "Volver a mi biblioteca";
    elements.ecosystemLink.href = "https://kinecheck.cl/academy/#biblioteca";
  }
  if (elements.retry) {
    elements.retry.hidden = !showRetry;
    elements.retry.textContent = "Reintentar acceso";
  }
}

function showEntry(text = "Abre este curso desde tu biblioteca KineCheck.") {
  setBusy(false);
  configureEntry({ copy: text, showLibrary: true, showRetry: false });
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
  const response = await fetchWithTimeout(`${CONFIG.supabaseUrl}/functions/v1/${CONFIG.courseKeyFunction}`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ courseSlug: EXPECTED_COURSE }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(
      data.message || "Tu cuenta no tiene una licencia activa de Más allá del dolor.",
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

async function start() {
  if (starting) return;
  starting = true;
  if (elements.message) elements.message.hidden = true;
  if (elements.ecosystemEntry) elements.ecosystemEntry.hidden = true;
  setBusy(true, "Recibiendo tu acceso desde KineCheck…");

  try {
    if (!configuredCorrectly()) throw new Error("La configuración de acceso no coincide con este producto.");
    const raw = readSession() || await waitForSession();
    if (!raw) {
      showEntry("No recibimos una sesión desde la biblioteca. Vuelve a Biblioteca y abre nuevamente este curso.");
      return;
    }
    const verified = await validateIdentity(raw);
    const source = await fetchCourseSource(verified.access_token);
    setBusy(true, "Preparando el curso protegido…");
    await launchCourse(source, verified);
  } catch (error) {
    setBusy(false);

    if (error.code === "NETWORK_ERROR") {
      showMessage(error.message, true);
      configureEntry({
        copy: "Tu sesión sigue guardada. Reintenta aquí sin volver a ingresar ni salir de esta pantalla.",
        showLibrary: true,
        showRetry: true,
      });
      return;
    }

    if (error.status === 403) {
      showMessage(`${error.message} Esta cuenta no tiene acceso a este producto.`, true);
      configureEntry({
        copy: "Vuelve a tu biblioteca para abrir únicamente tus productos activos.",
        showLibrary: true,
        showRetry: false,
      });
      return;
    }

    if (error.status === 401) clearSessions();
    showMessage(error.message || "No fue posible abrir el curso.", true);
    configureEntry({
      copy: error.status === 401
        ? "La sesión terminó. Vuelve a KineCheck e inicia sesión nuevamente una sola vez."
        : "Reintenta aquí o vuelve a tu biblioteca.",
      showLibrary: true,
      showRetry: error.status !== 401,
    });
  } finally {
    starting = false;
  }
}

elements.retry?.addEventListener("click", (event) => {
  event.preventDefault();
  start();
});

elements.signOut?.addEventListener("click", () => {
  clearSessions();
  location.replace("https://kinecheck.cl/academy/#biblioteca");
});

window.addEventListener("kinecheck:sso-received", () => start());
start();
