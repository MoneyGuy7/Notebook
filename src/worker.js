const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const rand = () => hex(crypto.getRandomValues(new Uint8Array(24)));
const sha = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc.encode(salt), iterations: 100000 }, k, 256));
}

export default {
  async fetch(req, env) {
    const p = new URL(req.url).pathname;
    if (!p.startsWith("/api/")) return env.ASSETS.fetch(req);
    try { return await api(req, env, p); } catch (e) { return J({ error: "Server error" }, 500); }
  }
};

async function api(req, env, p) {
  const body = req.method === "GET" || req.method === "DELETE" ? {} : await req.json().catch(() => ({}));

  if (p === "/api/login" && req.method === "POST") {
    const fk = "fail:" + (req.headers.get("cf-connecting-ip") || "x");
    const fails = +(await env.DB.get(fk)) || 0;
    if (fails >= 10) return J({ error: "Too many attempts. Try again in 15 minutes." }, 429);
    let sess = null;
    const pw = String(body.password || "");
    if (body.admin) {
      if (env.ADMIN_PASSWORD && (await sha(pw)) === (await sha(env.ADMIN_PASSWORD))) sess = { role: "admin" };
    } else {
      const u = await env.DB.get("user:" + String(body.username || "").toLowerCase().trim(), "json");
      if (u && (await hashPw(pw, u.salt)) === u.hash) sess = { role: "student", username: u.username, name: u.name };
    }
    if (!sess) {
      await env.DB.put(fk, String(fails + 1), { expirationTtl: 900 });
      return J({ error: body.admin ? "Wrong admin password" : "Wrong username or password" }, 401);
    }
    const token = rand();
    await env.DB.put("session:" + token, JSON.stringify(sess), { expirationTtl: 86400 * (sess.role === "admin" ? 30 : 90) });
    return J({ token, ...sess });
  }

  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  const s = token && (await env.DB.get("session:" + token, "json"));
  if (!s) return J({ error: "Not signed in" }, 401);
  if (s.role === "student" && !(await env.DB.get("user:" + s.username))) return J({ error: "Account removed" }, 401);

  if (p === "/api/me") return J(s);
  if (p === "/api/templates" && req.method === "GET") return J((await env.DB.get("templates", "json")) || []);
  if (s.role === "admin" && p.startsWith("/api/admin/templates")) {
    const list = (await env.DB.get("templates", "json")) || [];
    if (req.method === "POST") {
      const teacher = String(body.teacher || "").trim().slice(0, 60), className = String(body.className || "").trim().slice(0, 60);
      if (!teacher || !className) return J({ error: "Enter both a teacher and a class" }, 400);
      list.push({ id: rand().slice(0, 10), teacher, className });
      await env.DB.put("templates", JSON.stringify(list.slice(-500)));
      return J({ ok: 1 });
    }
    if (req.method === "DELETE") {
      const id = p.split("/").pop();
      await env.DB.put("templates", JSON.stringify(list.filter(t => t.id !== id)));
      return J({ ok: 1 });
    }
  }
  if (p === "/api/logout") { await env.DB.delete("session:" + token); return J({ ok: 1 }); }

  if (p === "/api/data" && s.role === "student") {
    const k = "data:" + s.username;
    if (req.method === "GET") return J((await env.DB.get(k, "json")) || { classes: [], assignments: [] });
    if (req.method === "PUT") {
      const d = {
        classes: Array.isArray(body.classes) ? body.classes.slice(0, 100) : [],
        assignments: Array.isArray(body.assignments) ? body.assignments.slice(0, 2000) : []
      };
      if (JSON.stringify(d).length > 800000) return J({ error: "Too much data" }, 413);
      await env.DB.put(k, JSON.stringify(d));
      return J({ ok: 1 });
    }
  }

  if (s.role === "admin" && p.startsWith("/api/admin/students")) {
    if (req.method === "GET") {
      const l = await env.DB.list({ prefix: "user:" }), out = [];
      for (const k of l.keys) { const u = await env.DB.get(k.name, "json"); out.push({ username: u.username, name: u.name }); }
      return J(out);
    }
    if (req.method === "POST") {
      const un = String(body.username || "").toLowerCase().trim(), pw = String(body.password || "");
      if (!/^[a-z0-9_.-]{3,30}$/.test(un) || pw.length < 4) return J({ error: "Username: 3-30 letters/numbers. Password: at least 4 characters." }, 400);
      const old = await env.DB.get("user:" + un, "json");
      if (old && !body.reset) return J({ error: "That username already exists" }, 409);
      const salt = rand();
      await env.DB.put("user:" + un, JSON.stringify({ username: un, name: String(body.name || old?.name || un).slice(0, 60), salt, hash: await hashPw(pw, salt) }));
      return J({ ok: 1 });
    }
    if (req.method === "DELETE") {
      const un = decodeURIComponent(p.split("/").pop());
      await env.DB.delete("user:" + un); await env.DB.delete("data:" + un);
      return J({ ok: 1 });
    }
  }
  return J({ error: "Not found" }, 404);
}
