(() => {
  "use strict";

  const COURSE_SLUG = "mas-alla-del-dolor";
  const SESSION_KEY = "kinecheck_course_session_v2:mas-alla-del-dolor";
  const LEGACY_SESSION_KEY = "kinecheck_course_session_v1:mas-alla-del-dolor";
  const LESSONS_KEY = "mad-lessons";
  const VALID_LESSONS = new Set(
    Array.from({ length: 8 }, (_, mi) =>
      Array.from({ length: 4 }, (_, li) => `${mi + 1}-${li + 1}`)
    ).flat()
  );
  let lastPayload = "";
  let timer = 0;

  function readJson(storage, key) {
    try { return JSON.parse(storage.getItem(key) || "null"); } catch { return null; }
  }

  function readSession() {
    return readJson(sessionStorage, SESSION_KEY)
      || readJson(localStorage, LEGACY_SESSION_KEY)
      || readJson(localStorage, SESSION_KEY);
  }

  function normalizeLessons(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(raw.map(String).filter((id) => VALID_LESSONS.has(id)))].sort();
  }

  async function userIdFor(session, config) {
    const embedded = String(session?.user?.id || "");
    if (embedded) return embedded;
    try {
      const response = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
        method: "GET",
        cache: "no-store",
        headers: {
          apikey: config.supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      if (!response.ok) return "";
      const user = await response.json().catch(() => ({}));
      return String(user?.id || "");
    } catch {
      return "";
    }
  }

  async function syncNow() {
    const config = window.KINECHECK_CONFIG || {};
    const session = readSession();
    if (!config.supabaseUrl || !config.supabaseAnonKey || !session?.access_token) return;

    const completedLessons = normalizeLessons(readJson(localStorage, LESSONS_KEY));
    const userId = await userIdFor(session, config);
    if (!userId) return;

    const state = {
      schemaVersion: 1,
      source: "mas-alla-del-dolor",
      completedLessons,
      completedLessonCount: completedLessons.length,
      totalLessons: 32,
      routeComplete: completedLessons.length === 32,
      updatedAt: new Date().toISOString(),
    };
    const payloadKey = JSON.stringify({ completedLessons, routeComplete: state.routeComplete });
    if (payloadKey === lastPayload) return;

    try {
      const response = await fetch(
        `${config.supabaseUrl}/rest/v1/learning_progress?on_conflict=user_id,course_slug`,
        {
          method: "POST",
          headers: {
            apikey: config.supabaseAnonKey,
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify({
            user_id: userId,
            course_slug: COURSE_SLUG,
            profile: "course",
            state,
            updated_at: state.updatedAt,
          }),
        }
      );
      if (response.ok) lastPayload = payloadKey;
    } catch {
      // La navegación del curso no depende de la sincronización.
    }
  }

  function scheduleSync() {
    window.clearTimeout(timer);
    timer = window.setTimeout(syncNow, 350);
  }

  function start() {
    const root = document.getElementById("root");
    if (!root) return;
    new MutationObserver(scheduleSync).observe(root, { childList: true, subtree: true });
    window.addEventListener("focus", scheduleSync);
    window.addEventListener("kinecheck:sso-received", scheduleSync);
    scheduleSync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
