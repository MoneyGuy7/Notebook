const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10), pad = n => String(n).padStart(2, "0");
let token = localStorage.getItem("an_token"), me = null, mode = "student", msg = "", students = [], templates = [];
let data = { classes: [], assignments: [] };

async function api(path, method = "GET", body) {
  const r = await fetch("/api/" + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && path !== "login") signOut(true); throw new Error(j.error || "Something went wrong"); }
  return j;
}
function signOut(local) {
  if (!local && token) api("logout", "POST").catch(() => {});
  localStorage.removeItem("an_token"); token = null; me = null; render();
}
let timer;
function save() { clearTimeout(timer); timer = setTimeout(() => api("data", "PUT", data).catch(e => { msg = e.message; render(); }), 400); }
async function boot() {
  me = await api("me"); templates = await api("templates");
  if (me.role === "admin") students = await api("admin/students");
  else { const d = await api("data"); data = { classes: d.classes || [], assignments: d.assignments || [] }; }
}

// Urgency mixes how soon it's due with how much of your free time it needs (assumes ~3 homework hours/day)
function urgency(a) {
  const left = (new Date(a.due) - Date.now()) / 36e5, est = a.est / 60;
  if (left <= 0) return { score: 100, label: "Overdue", cls: "crit" };
  const ratio = Math.min(1, est / Math.max(0.1, left / 24 * 3)), prox = 1 / (1 + left / 36);
  const score = Math.round(100 * (0.6 * ratio + 0.4 * prox));
  const [label, cls] = score >= 80 ? ["Critical", "crit"] : score >= 60 ? ["High", "high"] : score >= 40 ? ["Medium", "med"] : score >= 20 ? ["Low", "low"] : ["Relaxed", "chill"];
  return { score, label, cls };
}
function rel(d) {
  const h = (new Date(d) - Date.now()) / 36e5;
  if (h < 0) return h > -24 ? `${Math.round(-h)}h overdue` : `${Math.floor(-h / 24)}d overdue`;
  if (h < 1) return "due in under an hour";
  if (h < 24) return `due in ${Math.round(h)}h`;
  const n = Math.round(h / 24); return `due in ${n} day${n === 1 ? "" : "s"}`;
}
const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`;
const col = id => `hsl(${(Math.max(0, data.classes.findIndex(c => c.id === id)) * 67 + 210) % 360} 45% 42%)`;
const uniq = a => [...new Set(a)];

function item(a) {
  const u = urgency(a), c = data.classes.find(x => x.id === a.classId);
  const when = new Date(a.due).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return `<li class="item ${u.cls}"><div class="lvl">${u.label}<small>${u.score}/100</small></div>
  <div class="grow"><b>${esc(a.title)}</b><div class="meta"><i class="sw" style="background:${col(a.classId)}"></i>${esc(c ? c.name + (c.teacher ? " (" + c.teacher + ")" : "") : "No class")} · ${rel(a.due)}, ${when} · about ${fmtMin(a.est)}</div></div>
  <button data-act="done" data-id="${a.id}">Done</button><button class="ghost" data-act="del" data-id="${a.id}">Delete</button></li>`;
}

function renderLogin() {
  app.innerHTML = `<main class="login"><h1>Assignment Notebook</h1><p class="sub">Know what to do first.</p>
  <div class="tabs"><button data-act="mode" data-id="student" class="${mode === "student" ? "on" : ""}">Student</button><button data-act="mode" data-id="admin" class="${mode === "admin" ? "on" : ""}">Admin</button></div>
  <form id="lf">${mode === "student" ? '<input name="username" placeholder="Username" autocomplete="username" autocapitalize="none" required>' : ""}
  <input name="password" type="password" placeholder="${mode === "admin" ? "Admin password" : "Password"}" autocomplete="current-password" required>
  <button class="primary" style="width:100%">Sign in</button></form><p class="err">${esc(msg)}</p>
  <p class="hint">Accounts are made by your admin.</p></main>`;
}

function renderStudent() {
  const pending = data.assignments.filter(a => !a.done).sort((a, b) => urgency(b).score - urgency(a).score || new Date(a.due) - new Date(b.due));
  const done = data.assignments.filter(a => a.done), [first, ...rest] = pending;
  const have = t => data.classes.some(c => c.name.toLowerCase() === t.className.toLowerCase() && (c.teacher || "").toLowerCase() === t.teacher.toLowerCase());
  const avail = templates.filter(t => !have(t));
  app.innerHTML = `<header><b>${esc(me.name)}'s notebook</b><button data-act="out">Sign out</button></header>
  <div class="wrap"><div>
    <div class="card hero"><h2>${first ? "Do this first" : "All caught up"}</h2>${first ? `<ul>${item(first)}</ul>` : '<p class="meta">Add homework on the right to get started.</p>'}</div>
    ${rest.length ? `<div class="card"><h3>Up next</h3><ul>${rest.map(item).join("")}</ul></div>` : ""}
    ${done.length ? `<div class="card"><h3>Finished (${done.length}) <button class="ghost" data-act="clear">clear all</button></h3><ul>${done.map(a => `<li class="item chill"><div class="grow meta"><s>${esc(a.title)}</s></div><button class="ghost" data-act="undo" data-id="${a.id}">Undo</button></li>`).join("")}</ul></div>` : ""}
  </div><div>
    <div class="card"><h3>Add homework</h3>${data.classes.length ? `<form id="hf"><select name="classId">${data.classes.map(c => `<option value="${c.id}">${esc(c.name)}${c.teacher ? " (" + esc(c.teacher) + ")" : ""}</option>`).join("")}</select>
      <input name="title" placeholder="What is it?" required>
      <label class="meta">Due</label><input name="due" type="datetime-local" required>
      <div><button type="button" class="mini" data-act="due" data-id="0">Today</button><button type="button" class="mini" data-act="due" data-id="1">Tomorrow</button><button type="button" class="mini" data-act="due" data-id="7">In a week</button></div>
      <label class="meta">How long will it take? (hours, minutes)</label><div class="row"><input name="h" type="number" min="0" max="99" value="0"><input name="m" type="number" min="0" max="59" value="30"></div>
      <button class="primary" style="width:100%">Add homework</button></form>` : '<p class="meta">Add a class first.</p>'}</div>
    <div class="card"><h3>Classes</h3>${data.classes.map(c => `<div class="cls"><span><i class="sw" style="background:${col(c.id)}"></i>${esc(c.name)} <span class="meta">${esc(c.teacher || "")}</span></span><button class="ghost" data-act="delclass" data-id="${c.id}">remove</button></div>`).join("")}
      ${avail.length ? `<p class="meta" style="margin:12px 0 4px">Tap to add:</p>${avail.map(t => `<button class="mini" data-act="tpl" data-id="${t.id}">${esc(t.className)} · ${esc(t.teacher)}</button>`).join("")}` : ""}
      <p class="meta" style="margin:12px 0 4px">Or type one:</p>
      <form id="cf"><input name="name" list="cl" placeholder="Class name" autocomplete="off" required><input name="teacher" list="tl" placeholder="Teacher" autocomplete="off">
      <datalist id="cl">${uniq(templates.map(t => t.className)).map(x => `<option value="${esc(x)}">`).join("")}</datalist><datalist id="tl">${uniq(templates.map(t => t.teacher)).map(x => `<option value="${esc(x)}">`).join("")}</datalist>
      <button class="primary" style="width:100%">Add class</button></form></div>
    <p class="err">${esc(msg)}</p></div></div>`;
}

function renderAdmin() {
  app.innerHTML = `<header><b>Admin</b><button data-act="out">Sign out</button></header><div class="wrap" style="grid-template-columns:1fr 1fr">
  <div class="card"><h3>Students (${students.length})</h3><form id="sf"><input name="name" placeholder="Student's name" required><input name="username" placeholder="Username (letters/numbers)" autocapitalize="none" required>
  <input name="password" placeholder="Password (min 4)" required><button class="primary" style="width:100%">Create account</button></form><p class="err">${esc(msg)}</p>
  ${students.map(s => `<div class="cls"><span>${esc(s.name)} <span class="meta">@${esc(s.username)}</span></span><span><button class="ghost" data-act="reset" data-id="${esc(s.username)}">reset password</button><button class="ghost" data-act="rm" data-id="${esc(s.username)}">delete</button></span></div>`).join("")}</div>
  <div class="card"><h3>Class templates (${templates.length})</h3><p class="meta">Students can pick these or get them autofilled while typing.</p>
  <form id="tf"><input name="className" placeholder="Class (e.g. Algebra 2)" required><input name="teacher" placeholder="Teacher (e.g. Ms. Lee)" required><button class="primary" style="width:100%">Add template</button></form>
  ${templates.map(t => `<div class="cls"><span>${esc(t.className)} <span class="meta">${esc(t.teacher)}</span></span><button class="ghost" data-act="rmt" data-id="${t.id}">delete</button></div>`).join("")}</div></div>`;
}

function render() { if (!token || !me) return renderLogin(); me.role === "admin" ? renderAdmin() : renderStudent(); }

app.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, v = Object.fromEntries(new FormData(f)); msg = "";
  try {
    if (f.id === "lf") {
      const r = await api("login", "POST", mode === "admin" ? { admin: 1, password: v.password } : v);
      token = r.token; localStorage.setItem("an_token", token); await boot();
    } else if (f.id === "cf") { data.classes.push({ id: uid(), name: v.name.trim(), teacher: v.teacher.trim() }); save(); }
    else if (f.id === "hf") {
      data.assignments.push({ id: uid(), classId: v.classId, title: v.title.trim(), due: new Date(v.due).toISOString(), est: Math.max(5, (+v.h || 0) * 60 + (+v.m || 0)), done: false }); save();
    } else if (f.id === "sf") { await api("admin/students", "POST", v); students = await api("admin/students"); }
    else if (f.id === "tf") { await api("admin/templates", "POST", v); templates = await api("templates"); }
  } catch (err) { msg = err.message; }
  render();
});

// Typing a class or teacher that matches a template fills in the other box
app.addEventListener("input", e => {
  const f = e.target.form; if (!f || f.id !== "cf") return;
  const n = e.target.name, v = e.target.value.trim().toLowerCase();
  const ms = templates.filter(t => (n === "name" ? t.className : t.teacher).toLowerCase() === v);
  if (n === "name" && ms.length && !f.teacher.value) f.teacher.value = ms[0].teacher;
  if (n === "teacher" && ms.length === 1 && !f.name.value) f.name.value = ms[0].className;
});

app.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const { act, id } = b.dataset, A = data.assignments;
  try {
    if (act === "due") {
      const el = document.querySelector("#hf [name=due]"), d = new Date(); d.setDate(d.getDate() + +id);
      el.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${el.value.slice(11) || "23:59"}`; return;
    }
    if (act === "mode") { mode = id; msg = ""; }
    else if (act === "out") return signOut();
    else if (act === "done" || act === "undo") { A.find(x => x.id === id).done = act === "done"; save(); }
    else if (act === "del") { data.assignments = A.filter(x => x.id !== id); save(); }
    else if (act === "clear") { data.assignments = A.filter(x => !x.done); save(); }
    else if (act === "tpl") { const t = templates.find(x => x.id === id); data.classes.push({ id: uid(), name: t.className, teacher: t.teacher }); save(); }
    else if (act === "delclass") {
      if (!confirm("Remove this class and all its homework?")) return;
      data.classes = data.classes.filter(c => c.id !== id); data.assignments = A.filter(x => x.classId !== id); save();
    } else if (act === "reset") {
      const p = prompt("New password for " + id + " (min 4 characters):"); if (!p) return;
      await api("admin/students", "POST", { username: id, password: p, reset: 1 }); alert("Password changed.");
    } else if (act === "rm") {
      if (!confirm("Delete " + id + " and all their homework?")) return;
      await api("admin/students/" + encodeURIComponent(id), "DELETE"); students = await api("admin/students");
    } else if (act === "rmt") { await api("admin/templates/" + id, "DELETE"); templates = await api("templates"); }
  } catch (err) { msg = err.message; }
  render();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden && me && !document.querySelector("input:focus")) render(); });

if (token) boot().then(render).catch(() => { token = null; render(); }); else render();
