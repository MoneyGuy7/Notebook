const app = document.getElementById("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 10), pad = n => String(n).padStart(2, "0");
let token = localStorage.getItem("an_token"), me = null, mode = "student", msg = "", students = [], templates = [], editId = null, filter = "all", U = {};
let data = { classes: [], assignments: [], settings: { hpd: 3 } };
const TYPES = ["Homework", "Quiz", "Test", "Project"];
const gName = g => +g === 13 ? "Graduated" : g ? "Grade " + g : "No grade";
const gOpts = sel => `<option value="">No grade</option>` + Array.from({ length: 13 }, (_, i) => `<option value="${i + 1}"${+sel === i + 1 ? " selected" : ""}>${gName(i + 1)}</option>`).join("");
const gl = g => { if (!g || !g.length) return "all grades"; const s = [...g].sort((a, b) => a - b), r = []; let i = 0; while (i < s.length) { let j = i; while (s[j + 1] === s[j] + 1) j++; r.push(j > i ? `${s[i]}–${s[j]}` : `${s[i]}`); i = j + 1; } return (s.length > 1 ? "grades " : "grade ") + r.join(", "); };

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
  else { const d = await api("data"); data = { classes: d.classes || [], assignments: d.assignments || [], settings: { hpd: +d.settings?.hpd || 3 } }; }
}

const fmtMin = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? " " + (m % 60) + "m" : ""}` : `${m}m`;
const fmtH = h => fmtMin(Math.round(h * 60));
const toLocal = iso => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Urgency v2: a workload model. Assignments are sorted by due date, and each one is judged against the hours you
// can actually work before it's due, INCLUDING all the earlier-due work competing for those same hours.
//   own  = its remaining time / hours available      load = all work due by then / hours available      time = how close the deadline is
// Tests/quizzes/projects get a small boost, and progress shrinks the remaining time.
function scoreAll(list) {
  const hpd = data.settings.hpd, now = Date.now(), out = {}; let cum = 0;
  for (const a of [...list].sort((x, y) => new Date(x.due) - new Date(y.due))) {
    const rem = a.est * (1 - (a.progress || 0) / 100) / 60, left = (new Date(a.due) - now) / 36e5; cum += rem;
    if (left <= 0) { out[a.id] = { score: 100, label: "Overdue", cls: "crit", why: "Past its due date." }; continue; }
    const cap = Math.max(0.05, left / 24 * hpd), own = Math.min(1, rem / cap), load = Math.min(1, cum / cap), time = 1 / (1 + left / 36);
    const w = { Homework: 1, Quiz: 1.1, Project: 1.1, Test: 1.2 }[a.type || "Homework"] || 1;
    const score = Math.min(99, Math.round(100 * (0.45 * own + 0.3 * load + 0.25 * time) * w));
    const [label, cls] = score >= 80 ? ["Critical", "crit"] : score >= 60 ? ["High", "high"] : score >= 40 ? ["Medium", "med"] : score >= 20 ? ["Low", "low"] : ["Relaxed", "chill"];
    out[a.id] = { score, label, cls, startBy: new Date(a.due) - rem / hpd * 864e5, why: `Needs ${fmtH(rem)} of the ~${fmtH(cap)} you can work before it's due. ${fmtH(cum)} of work is due by then in total.` };
  }
  return out;
}
function rel(d) {
  const h = (new Date(d) - Date.now()) / 36e5;
  if (h < 0) return h > -24 ? `${Math.round(-h)}h overdue` : `${Math.floor(-h / 24)}d overdue`;
  if (h < 1) return "due in under an hour";
  if (h < 24) return `due in ${Math.round(h)}h`;
  const n = Math.round(h / 24); return `due in ${n} day${n === 1 ? "" : "s"}`;
}
const col = id => `hsl(${(Math.max(0, data.classes.findIndex(c => c.id === id)) * 67 + 210) % 360} 45% 42%)`;
const uniq = a => [...new Set(a)];

function item(a) {
  const u = U[a.id], c = data.classes.find(x => x.id === a.classId), p = a.progress || 0;
  const when = new Date(a.due).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const sb = u.startBy ? (u.startBy <= Date.now() ? " · start now" : " · start by " + new Date(u.startBy).toLocaleDateString([], { weekday: "short" })) : "";
  return `<li class="item ${u.cls}"><div class="lvl" title="${esc(u.why)}">${u.label}<small>${u.score}/100</small></div>
  <div class="grow"><b>${esc(a.title)}</b>${a.type && a.type !== "Homework" ? ` <span class="tag">${a.type}</span>` : ""}<div class="meta"><i class="sw" style="background:${col(a.classId)}"></i>${esc(c ? c.name + (c.teacher ? " (" + c.teacher + ")" : "") : "No class")} · ${rel(a.due)}, ${when} · ${fmtMin(Math.round(a.est * (1 - p / 100)))} left${sb}</div></div>
  <select class="prog" data-ch="prog" data-id="${a.id}" title="Progress">${[0, 25, 50, 75].map(v => `<option value="${v}"${v === p ? " selected" : ""}>${v}%</option>`).join("")}</select>
  <button data-act="done" data-id="${a.id}">Done</button><button class="ghost" data-act="edit" data-id="${a.id}">Edit</button><button class="ghost" data-act="del" data-id="${a.id}">Delete</button></li>`;
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
  const all = data.assignments.filter(a => !a.done); U = scoreAll(all);
  const sorted = [...all].sort((a, b) => U[b.id].score - U[a.id].score || new Date(a.due) - new Date(b.due));
  const shown = filter === "all" ? sorted : sorted.filter(a => a.classId === filter), [first, ...rest] = shown;
  const done = data.assignments.filter(a => a.done), ed = data.assignments.find(a => a.id === editId);
  const work = all.reduce((s, a) => s + a.est * (1 - (a.progress || 0) / 100), 0), over = all.filter(a => U[a.id].label === "Overdue").length;
  const week = all.filter(a => { const h = (new Date(a.due) - Date.now()) / 36e5; return h > 0 && h < 168; }).length;
  const have = t => data.classes.some(c => c.name.toLowerCase() === t.className.toLowerCase() && (c.teacher || "").toLowerCase() === t.teacher.toLowerCase());
  const avail = templates.filter(t => !have(t));
  app.innerHTML = `<header><b>${esc(me.name)}'s notebook${me.grade ? " · " + gName(me.grade) : ""}</b><button data-act="out">Sign out</button></header>
  <div class="wrap"><div>
    <div class="stats"><div><b>${all.length}</b> to do</div><div><b>${over}</b> overdue</div><div><b>${week}</b> due this week</div><div><b>${fmtMin(Math.round(work))}</b> of work left</div></div>
    ${data.classes.length > 1 ? `<div class="chips"><button class="mini${filter === "all" ? " on" : ""}" data-act="filter" data-id="all">All classes</button>${data.classes.map(c => `<button class="mini${filter === c.id ? " on" : ""}" data-act="filter" data-id="${c.id}">${esc(c.name)}</button>`).join("")}</div>` : ""}
    <div class="card hero"><h2>${first ? "Do this first" : "All caught up"}</h2>${first ? `<ul>${item(first)}</ul>` : '<p class="meta">Nothing due. Add homework on the right.</p>'}</div>
    ${rest.length ? `<div class="card"><h3>Up next</h3><ul>${rest.map(item).join("")}</ul></div>` : ""}
    ${done.length ? `<div class="card"><h3>Finished (${done.length}) <button class="ghost" data-act="clear">clear all</button></h3><ul>${done.map(a => `<li class="item chill"><div class="grow meta"><s>${esc(a.title)}</s></div><button class="ghost" data-act="undo" data-id="${a.id}">Undo</button></li>`).join("")}</ul></div>` : ""}
  </div><div>
    <div class="card"><h3>${ed ? "Edit homework" : "Add homework"}</h3>${data.classes.length ? `<form id="hf"><select name="classId">${data.classes.map(c => `<option value="${c.id}"${ed && ed.classId === c.id ? " selected" : ""}>${esc(c.name)}${c.teacher ? " (" + esc(c.teacher) + ")" : ""}</option>`).join("")}</select>
      <input name="title" placeholder="What is it?" value="${esc(ed?.title)}" required>
      <select name="type">${TYPES.map(t => `<option${ed?.type === t ? " selected" : ""}>${t}</option>`).join("")}</select>
      <label class="meta">Due</label><input name="due" type="datetime-local" value="${ed ? toLocal(ed.due) : ""}" required>
      <div><button type="button" class="mini" data-act="due" data-id="0">Today</button><button type="button" class="mini" data-act="due" data-id="1">Tomorrow</button><button type="button" class="mini" data-act="due" data-id="7">In a week</button></div>
      <label class="meta">How long will it take? (hours, minutes)</label><div class="row"><input name="h" type="number" min="0" max="99" value="${ed ? Math.floor(ed.est / 60) : 0}"><input name="m" type="number" min="0" max="59" value="${ed ? ed.est % 60 : 30}"></div>
      <button class="primary" style="width:100%">${ed ? "Save changes" : "Add homework"}</button>${ed ? '<button type="button" class="ghost" data-act="cancel">cancel</button>' : ""}</form>` : '<p class="meta">Add a class first.</p>'}</div>
    <div class="card"><h3>Classes</h3>${data.classes.map(c => `<div class="cls"><span><i class="sw" style="background:${col(c.id)}"></i>${esc(c.name)} <span class="meta">${esc(c.teacher || "")}</span></span><button class="ghost" data-act="delclass" data-id="${c.id}">remove</button></div>`).join("")}
      ${avail.length ? `<p class="meta" style="margin:12px 0 4px">Tap to add:</p>${avail.map(t => `<button class="mini" data-act="tpl" data-id="${t.id}">${esc(t.className)} · ${esc(t.teacher)}</button>`).join("")}` : ""}
      <p class="meta" style="margin:12px 0 4px">Or type one:</p>
      <form id="cf"><input name="name" list="cl" placeholder="Class name" autocomplete="off" required><input name="teacher" list="tl" placeholder="Teacher" autocomplete="off">
      <datalist id="cl">${uniq(templates.map(t => t.className)).map(x => `<option value="${esc(x)}">`).join("")}</datalist><datalist id="tl">${uniq(templates.map(t => t.teacher)).map(x => `<option value="${esc(x)}">`).join("")}</datalist>
      <button class="primary" style="width:100%">Add class</button></form></div>
    <div class="card"><h3>Settings</h3><label class="meta">Hours of homework you can do per day (used for urgency)</label><input type="number" min="0.5" max="12" step="0.5" value="${data.settings.hpd}" data-ch="hpd"></div>
    <p class="err">${esc(msg)}</p></div></div>`;
}

function renderAdmin() {
  const list = [...students].sort((a, b) => (+a.grade || 99) - (+b.grade || 99) || a.name.localeCompare(b.name));
  app.innerHTML = `<header><b>Admin</b><button data-act="out">Sign out</button></header><div class="wrap" style="grid-template-columns:1fr 1fr">
  <div class="card"><h3>Students (${students.length})</h3><form id="sf"><input name="name" placeholder="Student's name" required><input name="username" placeholder="Username (letters/numbers)" autocapitalize="none" required>
  <input name="password" placeholder="Password (min 4)" required><select name="grade">${gOpts("")}</select><button class="primary" style="width:100%">Create account</button></form><p class="err">${esc(msg)}</p>
  ${students.length ? '<button class="mini" data-act="promoteAll">Move everyone up a grade</button>' : ""}
  ${list.map(s => `<div class="cls"><span>${esc(s.name)} <span class="meta">@${esc(s.username)}</span></span><span><select data-ch="sgrade" data-id="${esc(s.username)}">${gOpts(s.grade)}</select><button class="ghost" data-act="promote" data-id="${esc(s.username)}">move up</button><button class="ghost" data-act="reset" data-id="${esc(s.username)}">reset pw</button><button class="ghost" data-act="rm" data-id="${esc(s.username)}">delete</button></span></div>`).join("")}</div>
  <div class="card"><h3>Class templates (${templates.length})</h3><p class="meta">Students only see templates for their grade. Leave all grades unchecked to show a template to everyone, or check several for classes like PE.</p>
  <form id="tf"><input name="className" placeholder="Class (e.g. Algebra 2)" required><input name="teacher" placeholder="Teacher (e.g. Ms. Lee)" required>
  <div class="grades">${Array.from({ length: 12 }, (_, i) => `<label><input type="checkbox" name="g" value="${i + 1}">${i + 1}</label>`).join("")}</div>
  <div><button type="button" class="mini" data-act="gset" data-id="6-8">6–8</button><button type="button" class="mini" data-act="gset" data-id="9-12">9–12</button><button type="button" class="mini" data-act="gset" data-id="1-12">All</button><button type="button" class="mini" data-act="gset" data-id="none">Clear</button></div>
  <button class="primary" style="width:100%">Add template</button></form>
  ${templates.map(t => `<div class="cls"><span>${esc(t.className)} <span class="meta">${esc(t.teacher)} · ${gl(t.grades)}</span></span><button class="ghost" data-act="rmt" data-id="${t.id}">delete</button></div>`).join("")}</div></div>`;
}

function render() { if (!token || !me) return renderLogin(); me.role === "admin" ? renderAdmin() : renderStudent(); }

app.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target, fd = new FormData(f), v = Object.fromEntries(fd); msg = "";
  try {
    if (f.id === "lf") {
      const r = await api("login", "POST", mode === "admin" ? { admin: 1, password: v.password } : v);
      token = r.token; localStorage.setItem("an_token", token); await boot();
    } else if (f.id === "cf") { data.classes.push({ id: uid(), name: v.name.trim(), teacher: v.teacher.trim() }); save(); }
    else if (f.id === "hf") {
      const rec = { classId: v.classId, title: v.title.trim(), type: v.type, due: new Date(v.due).toISOString(), est: Math.max(5, (+v.h || 0) * 60 + (+v.m || 0)) };
      if (editId) { Object.assign(data.assignments.find(a => a.id === editId), rec); editId = null; }
      else data.assignments.push({ id: uid(), done: false, progress: 0, ...rec });
      save();
    } else if (f.id === "sf") { await api("admin/students", "POST", v); students = await api("admin/students"); }
    else if (f.id === "tf") { await api("admin/templates", "POST", { className: v.className, teacher: v.teacher, grades: fd.getAll("g") }); templates = await api("templates"); }
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

app.addEventListener("change", async e => {
  const t = e.target, ch = t.dataset.ch; if (!ch) return;
  try {
    if (ch === "prog") { data.assignments.find(a => a.id === t.dataset.id).progress = +t.value; save(); }
    else if (ch === "hpd") { data.settings.hpd = Math.min(12, Math.max(0.5, +t.value || 3)); save(); }
    else if (ch === "sgrade") { await api("admin/grade", "POST", { username: t.dataset.id, grade: t.value }); students = await api("admin/students"); }
  } catch (err) { msg = err.message; }
  render();
});

const askClear = () => confirm("Also clear their old classes and homework?\nOK = clear them, Cancel = keep them");
app.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const { act, id } = b.dataset, A = data.assignments;
  try {
    if (act === "due") {
      const el = document.querySelector("#hf [name=due]"), d = new Date(); d.setDate(d.getDate() + +id);
      el.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${el.value.slice(11) || "23:59"}`; return;
    }
    if (act === "gset") {
      const [lo, hi] = id === "none" ? [0, 0] : id.split("-").map(Number);
      document.querySelectorAll("#tf [name=g]").forEach(c => c.checked = lo > 0 && +c.value >= lo && +c.value <= hi); return;
    }
    if (act === "mode") { mode = id; msg = ""; }
    else if (act === "out") return signOut();
    else if (act === "filter") filter = id;
    else if (act === "edit") { editId = id; render(); document.getElementById("hf")?.scrollIntoView({ behavior: "smooth" }); return; }
    else if (act === "cancel") editId = null;
    else if (act === "done" || act === "undo") { A.find(x => x.id === id).done = act === "done"; save(); }
    else if (act === "del") { data.assignments = A.filter(x => x.id !== id); save(); }
    else if (act === "clear") { data.assignments = A.filter(x => !x.done); save(); }
    else if (act === "tpl") { const t = templates.find(x => x.id === id); data.classes.push({ id: uid(), name: t.className, teacher: t.teacher }); save(); }
    else if (act === "delclass") {
      if (!confirm("Remove this class and all its homework?")) return;
      data.classes = data.classes.filter(c => c.id !== id); data.assignments = A.filter(x => x.classId !== id); if (filter === id) filter = "all"; save();
    } else if (act === "reset") {
      const p = prompt("New password for " + id + " (min 4 characters):"); if (!p) return;
      await api("admin/students", "POST", { username: id, password: p, reset: 1 }); alert("Password changed.");
    } else if (act === "rm") {
      if (!confirm("Delete " + id + " and all their homework?")) return;
      await api("admin/students/" + encodeURIComponent(id), "DELETE"); students = await api("admin/students");
    } else if (act === "promote") {
      const s = students.find(x => x.username === id);
      await api("admin/grade", "POST", { username: id, grade: Math.min(13, (+s.grade || 0) + 1), clear: askClear() }); students = await api("admin/students");
    } else if (act === "promoteAll") {
      if (!confirm("Move every student (who has a grade) up one grade?")) return;
      await api("admin/grade", "POST", { all: true, clear: askClear() }); students = await api("admin/students");
    } else if (act === "rmt") { await api("admin/templates/" + id, "DELETE"); templates = await api("templates"); }
  } catch (err) { msg = err.message; }
  render();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden && me && !document.querySelector("input:focus")) render(); });

if (token) boot().then(render).catch(() => { token = null; render(); }); else render();
