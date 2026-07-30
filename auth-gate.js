const CONFIG = window.KINECHECK_CONFIG || {};
const SESSION_KEY = "kinecheck_secure_session_v1";
const $ = (selector) => document.querySelector(selector);

const elements = {
  shell: $("#access-shell"),
  root: $("#root"),
  authPanel: $("#auth-panel"),
  authForm: $("#auth-form"),
  recoveryForm: $("#recovery-form"),
  loginTab: $("#login-tab"),
  signupTab: $("#signup-tab"),
  email: $("#email"),
  password: $("#password"),
  newPassword: $("#new-password"),
  submit: $("#auth-submit"),
  forgot: $("#forgot-password"),
  message: $("#auth-message"),
  progress: $("#access-progress"),
  progressMessage: $("#progress-message"),
  setupWarning: $("#setup-warning"),
  signOut: $("#sign-out"),
};
let mode = "login";

function resolvedCourseSlug() {
  return String(CONFIG.courseSlug || "mas-alla-del-dolor").trim();
}

function isConfigured() {
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && CONFIG.courseKeyFunction;
}

function authHeaders(accessToken) {
  const headers = { apikey: CONFIG.supabaseAnonKey, "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

async function request(path, options = {}) {
  const response = await fetch(`${CONFIG.supabaseUrl}${path}`, {
    ...options,
    headers: { ...authHeaders(options.accessToken), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.msg || data.message || data.error_description || data.error || "Solicitud rechazada");
    error.status = response.status;
    throw error;
  }
  return data;
}

function showMessage(text, kind = "info") {
  elements.message.textContent = text;
  elements.message.className = `notice${kind === "error" ? " notice-error" : ""}`;
  elements.message.hidden = false;
}

function hideMessage() {
  elements.message.hidden = true;
  elements.message.textContent = "";
}

function setBusy(busy, text = "Verificando tu acceso…") {
  elements.authPanel.hidden = busy;
  if (elements.recoveryForm) elements.recoveryForm.hidden = true;
  elements.progress.hidden = !busy;
  elements.progressMessage.textContent = text;
  elements.submit.disabled = busy;
}

function saveSession(session) {
  const expiresAt = session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: expiresAt }));
}

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}

function clearSession() { localStorage.removeItem(SESSION_KEY); }

async function validateIdentity(session) {
  const user = await request("/auth/v1/user", {
    method: "GET",
    accessToken: session.access_token,
  });
  const verified = { ...session, user };
  saveSession(verified);
  return verified;
}

async function validSession() {
  let session = readSession();
  if (!session?.access_token) return null;

  try {
    if (Number(session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60) {
      session = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      saveSession(session);
    }
    return await validateIdentity(session);
  } catch {
    try {
      session = await request("/auth/v1/token?grant_type=refresh_token", {
        method: "POST",
        body: JSON.stringify({ refresh_token: session.refresh_token }),
      });
      saveSession(session);
      return await validateIdentity(session);
    } catch {
      clearSession();
      return null;
    }
  }
}

async function fetchCourseSource(accessToken) {
  const courseSlug = resolvedCourseSlug();
  const response = await fetch(`${CONFIG.supabaseUrl}/functions/v1/${CONFIG.courseKeyFunction}`, {
    method: "POST",
    headers: authHeaders(accessToken),
    body: JSON.stringify({ courseSlug }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(data.message || "No encontramos una compra activa asociada a este correo.");
    error.status = response.status;
    throw error;
  }
  return {
    courseSlug,
    source: await response.text(),
  };
}

async function launchCourse(source, session, courseSlug) {
  elements.root.hidden = false;
  const moduleUrl = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    await import(moduleUrl);
    if (!window.KineCheckWatermark) {
      throw new Error("No fue posible activar la protección de uso personal.");
    }
    await window.KineCheckWatermark.showVerifiedBuyer({
      user: session.user,
      licenseScopes: [courseSlug],
    });
    elements.shell.hidden = true;
    elements.signOut.hidden = false;
  } catch (error) {
    window.KineCheckWatermark?.hide();
    elements.root.hidden = true;
    elements.shell.hidden = false;
    elements.signOut.hidden = true;
    throw new Error(`El contenido no pudo iniciarse: ${error.message}`);
  } finally {
    URL.revokeObjectURL(moduleUrl);
  }
}

async function authorizeAndLaunch(session) {
  setBusy(true, "Validando tu acceso en KineCheck Academy…");
  hideMessage();
  try {
    const course = await fetchCourseSource(session.access_token);
    elements.progressMessage.textContent = "Preparando el curso protegido…";
    await launchCourse(course.source, session, course.courseSlug);
  } catch (error) {
    window.KineCheckWatermark?.hide();
    setBusy(false);
    if (error.status === 401) clearSession();
    const support = CONFIG.supportEmail ? ` Si necesitas ayuda, escribe a ${CONFIG.supportEmail}.` : "";
    showMessage(`${error.message}${support}`, "error");
  }
}

function setMode(nextMode) {
  mode = nextMode;
  const signup = mode === "signup";
  elements.loginTab.classList.toggle("active", !signup);
  elements.signupTab.classList.toggle("active", signup);
  elements.submit.textContent = signup ? "Crear mi cuenta" : "Ingresar al curso";
  elements.password.autocomplete = signup ? "new-password" : "current-password";
  hideMessage();
}

elements.loginTab.addEventListener("click", () => setMode("login"));
elements.signupTab.addEventListener("click", () => setMode("signup"));

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage();
  const email = elements.email.value.trim().toLowerCase();
  const password = elements.password.value;
  if (!email || password.length < 8) return showMessage("Ingresa un correo válido y una contraseña de al menos 8 caracteres.", "error");
  try {
    let session = mode === "login"
      ? await request("/auth/v1/token?grant_type=password", { method: "POST", body: JSON.stringify({ email, password }) })
      : await request("/auth/v1/signup", { method: "POST", body: JSON.stringify({ email, password, data: { source: "kinecheck-secure-access" } }) });
    if (!session.access_token) {
      setMode("login");
      elements.email.value = email;
      return showMessage("Cuenta creada. Revisa tu correo y confirma la dirección antes de ingresar.");
    }
    saveSession(session);
    session = await validateIdentity(session);
    await authorizeAndLaunch(session);
  } catch (error) {
    setBusy(false);
    showMessage(error.message, "error");
  }
});

if (elements.forgot) {
  elements.forgot.addEventListener("click", async () => {
    hideMessage();
    const email = elements.email.value.trim().toLowerCase();
    if (!email) return showMessage("Escribe primero el correo utilizado en tu compra.", "error");
    try {
      await request("/auth/v1/recover", {
        method: "POST",
        body: JSON.stringify({ email, redirect_to: location.href.split("#")[0] }),
      });
      showMessage("Te enviamos un enlace para restablecer tu contraseña.");
    } catch (error) {
      showMessage(error.message, "error");
    }
  });
}

elements.signOut.addEventListener("click", async () => {
  window.KineCheckWatermark?.hide();
  const session = readSession();
  if (session?.access_token) {
    await request("/auth/v1/logout", { method: "POST", accessToken: session.access_token }).catch(() => {});
  }
  clearSession();
  location.reload();
});

(async function start() {
  if (!isConfigured()) {
    elements.setupWarning.hidden = false;
    return;
  }
  const session = await validSession();
  if (session) await authorizeAndLaunch(session);
})();
