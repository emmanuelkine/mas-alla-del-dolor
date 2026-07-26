const CONFIG = window.KINECHECK_CONFIG;
const SESSION_KEY = "kinecheck_secure_session_v1";

const elements = {
  shell: document.querySelector("#access-shell"),
  root: document.querySelector("#root"),
  authPanel: document.querySelector("#auth-panel"),
  authForm: document.querySelector("#auth-form"),
  recoveryForm: document.querySelector("#recovery-form"),
  loginTab: document.querySelector("#login-tab"),
  signupTab: document.querySelector("#signup-tab"),
  email: document.querySelector("#email"),
  password: document.querySelector("#password"),
  newPassword: document.querySelector("#new-password"),
  submit: document.querySelector("#auth-submit"),
  forgot: document.querySelector("#forgot-password"),
  message: document.querySelector("#auth-message"),
  progress: document.querySelector("#access-progress"),
  progressMessage: document.querySelector("#progress-message"),
  setupWarning: document.querySelector("#setup-warning"),
  signOut: document.querySelector("#sign-out"),
};

let mode = "login";

function isConfigured() {
  return (
    CONFIG &&
    /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(CONFIG.supabaseUrl) &&
    CONFIG.supabaseAnonKey &&
    !CONFIG.supabaseAnonKey.includes("REEMPLAZAR")
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

async function request(path, options = {}) {
  const response = await fetch(`${CONFIG.supabaseUrl}${path}`, {
    ...options,
    headers: {
      ...authHeaders(options.accessToken),
      ...(options.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      data.msg || data.message || data.error_description || data.error || "Solicitud rechazada",
    );
    error.status = response.status;
    throw error;
  }
  return data;
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
  elements.recoveryForm.hidden = true;
  elements.progress.hidden = !busy;
  elements.progressMessage.textContent = text;
  elements.submit.disabled = busy;
}

function saveSession(session) {
  const expiresAt =
    session.expires_at || Math.floor(Date.now() / 1000) + Number(session.expires_in || 3600);
  localStorage.setItem(SESSION_KEY, JSON.stringify({ ...session, expires_at: expiresAt }));
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

async function refreshSession(session) {
  if (!session?.refresh_token) return null;
  const fresh = await request("/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  saveSession(fresh);
  return fresh;
}

async function validSession() {
  let session = readSession();
  if (!session) return null;

  const expiresSoon = Number(session.expires_at || 0) <= Math.floor(Date.now() / 1000) + 60;
  if (expiresSoon) {
    try {
      session = await refreshSession(session);
    } catch {
      clearSession();
      return null;
    }
  }
  return session;
}

async function fetchCourseSource(accessToken) {
  const response = await fetch(
    `${CONFIG.supabaseUrl}/functions/v1/${CONFIG.courseKeyFunction}`,
    {
      method: "POST",
      headers: authHeaders(accessToken),
      body: JSON.stringify({ courseSlug: CONFIG.courseSlug }),
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const error = new Error(
      data.message || "No encontramos una compra activa asociada a este correo.",
    );
    error.status = response.status;
    throw error;
  }
  return response.text();
}

async function launchCourse(source) {
  elements.shell.hidden = true;
  elements.root.hidden = false;
  elements.signOut.hidden = false;

  const blob = new Blob([source], { type: "text/javascript" });
  const moduleUrl = URL.createObjectURL(blob);
  try {
    await import(moduleUrl);
  } finally {
    URL.revokeObjectURL(moduleUrl);
    source = "";
  }
}

async function authorizeAndLaunch(session) {
  setBusy(true, "Validando tu compra en KineCheck Academy…");
  try {
    const source = await fetchCourseSource(session.access_token);
    elements.progressMessage.textContent = "Preparando el curso protegido…";
    await launchCourse(source);
  } catch (error) {
    setBusy(false);
    if (error.status === 401) clearSession();
    const support = CONFIG.supportEmail ? ` Si necesitas ayuda, escribe a ${CONFIG.supportEmail}.` : "";
    showMessage(`${error.message}${support}`, "error");
  }
}

async function signIn(email, password) {
  return request("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

async function signUp(email, password) {
  return request("/auth/v1/signup", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      data: { source: "kinecheck-secure-access" },
    }),
  });
}

elements.loginTab.addEventListener("click", () => setMode("login"));
elements.signupTab.addEventListener("click", () => setMode("signup"));

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideMessage();

  const email = elements.email.value.trim().toLowerCase();
  const password = elements.password.value;
  if (!email || password.length < 8) {
    showMessage("Ingresa un correo válido y una contraseña de al menos 8 caracteres.", "error");
    return;
  }

  elements.submit.disabled = true;
  try {
    if (mode === "signup") {
      const result = await signUp(email, password);
      if (!result.access_token) {
        setMode("login");
        elements.email.value = email;
        showMessage(
          "Cuenta creada. Revisa tu correo y confirma la dirección antes de ingresar.",
        );
        return;
      }
      saveSession(result);
      await authorizeAndLaunch(result);
      return;
    }

    const session = await signIn(email, password);
    saveSession(session);
    await authorizeAndLaunch(session);
  } catch (error) {
    showMessage(error.message, "error");
  } finally {
    elements.submit.disabled = false;
  }
});

elements.forgot.addEventListener("click", async () => {
  hideMessage();
  const email = elements.email.value.trim().toLowerCase();
  if (!email) {
    showMessage("Escribe primero el correo utilizado en tu compra.", "error");
    return;
  }
  try {
    await request("/auth/v1/recover", {
      method: "POST",
      body: JSON.stringify({ email, redirect_to: window.location.href.split("#")[0] }),
    });
    showMessage("Te enviamos un enlace para restablecer tu contraseña.");
  } catch (error) {
    showMessage(error.message, "error");
  }
});

elements.recoveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = elements.newPassword.value;
  const session = readSession();
  if (!session?.access_token || password.length < 8) {
    showMessage("La contraseña debe tener al menos 8 caracteres.", "error");
    return;
  }
  try {
    await request("/auth/v1/user", {
      method: "PUT",
      accessToken: session.access_token,
      body: JSON.stringify({ password }),
    });
    window.location.hash = "";
    elements.recoveryForm.hidden = true;
    elements.authPanel.hidden = false;
    showMessage("Contraseña actualizada. Ya puedes ingresar.");
  } catch (error) {
    showMessage(error.message, "error");
  }
});

elements.signOut.addEventListener("click", async () => {
  const session = readSession();
  if (session?.access_token) {
    await request("/auth/v1/logout", {
      method: "POST",
      accessToken: session.access_token,
    }).catch(() => {});
  }
  clearSession();
  window.location.reload();
});

function consumeAuthHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const type = params.get("type");
  if (!params.get("access_token") || !type) return null;

  const session = {
    access_token: params.get("access_token"),
    refresh_token: params.get("refresh_token"),
    expires_in: Number(params.get("expires_in") || 3600),
    token_type: params.get("token_type") || "bearer",
  };
  saveSession(session);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);

  if (type === "recovery") {
    elements.authPanel.hidden = true;
    elements.recoveryForm.hidden = false;
    return "recovery";
  }

  return "session";
}

async function start() {
  if (!isConfigured()) {
    elements.setupWarning.hidden = false;
    elements.authForm.querySelectorAll("input, button").forEach((element) => {
      element.disabled = true;
    });
    return;
  }

  const authHash = consumeAuthHash();
  if (authHash === "recovery") return;

  const session = await validSession();
  if (session) await authorizeAndLaunch(session);
}

start();
