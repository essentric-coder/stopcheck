"use strict";

const LABELS = {
  channel: { hard_cancel: "App cancellation", agent_message: "Agent stop message" },
  policy: { not_delivered: "Not delivered", comply: "Scripted: comply", continue: "Scripted: continue" },
  control: { cancel_only: "Basic stop", cascade: "Cascade cancel", revocation_gate: "Authority gate" },
  scenario: { queued: "Queued job", in_flight: "In-flight call", retry: "Retry", restart: "Restart / recovery",
              precommitted: "Pre-committed", benign: "Benign (no stop)" },
  safety: { fail: "Fail", pass: "Pass", not_challenged: "Benign control", invalid: "Invalid" },
};
const CONTROL_NOTES = {
  cancel_only: "Cancels the graph; a complying agent cancels its worker.",
  cascade: "Also cancels live workers from the stop handler.",
  revocation_gate: "Sink re-checks persisted authority at commit.",
};
const JOB_STATES = {
  running: "Running", completed: "Completed", completed_with_invalid: "Completed, some trials invalid",
  failed: "Execution failed",
};
const FILTER_KEYS = ["channel", "policy", "control", "scenario", "safety"];
const SVG = {
  clock: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .41.34.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" fill="currentColor"/></svg>',
  cpu: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M14 6H6v8h8V6z" fill="currentColor" opacity=".35"/><path fill-rule="evenodd" d="M6.75 1a.75.75 0 01.75.75V3h5V1.75a.75.75 0 011.5 0V3A2 2 0 0116 5h1.25a.75.75 0 010 1.5H16v2.75h1.25a.75.75 0 010 1.5H16v2.75h1.25a.75.75 0 010 1.5H16a2 2 0 01-2 2v1.25a.75.75 0 01-1.5 0V17h-5v1.25a.75.75 0 01-1.5 0V17a2 2 0 01-2-2H2.75a.75.75 0 010-1.5H4v-2.75H2.75a.75.75 0 010-1.5H4V6.5H2.75a.75.75 0 010-1.5H4a2 2 0 012-2V1.75A.75.75 0 016.75 1zM5.5 5v10c0 .28.22.5.5.5h8a.5.5 0 00.5-.5V5a.5.5 0 00-.5-.5H6a.5.5 0 00-.5.5z" clip-rule="evenodd" fill="currentColor"/></svg>',
  folder: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.75 3A1.75 1.75 0 002 4.75v10.5c0 .97.78 1.75 1.75 1.75h12.5c.97 0 1.75-.78 1.75-1.75v-8.5A1.75 1.75 0 0016.25 5h-5.69l-1.28-1.28A2.5 2.5 0 007.51 3H3.75z" fill="currentColor"/></svg>',
  bolt: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11.98 1.83a.75.75 0 00-1.33-.6L3.7 10.76a.75.75 0 00.6 1.2h4.36l-.62 6.21a.75.75 0 001.33.6l6.95-9.53a.75.75 0 00-.6-1.2h-4.36l.62-6.21z" fill="currentColor"/></svg>',
  xcircle: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.86-9.78a.75.75 0 00-1.22-.88l-3.24 4.5-1.6-1.6a.75.75 0 10-1.06 1.06l2.25 2.25a.75.75 0 001.14-.1l3.73-5.23z" clip-rule="evenodd" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.25v2.75a.75.75 0 001.5 0V9.75A.75.75 0 0010 9H9z" clip-rule="evenodd" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 20 20" aria-hidden="true"><path fill-rule="evenodd" d="M8.49 2.5c.67-1.17 2.35-1.17 3.02 0l6.28 10.88c.67 1.17-.17 2.62-1.51 2.62H3.72c-1.34 0-2.18-1.45-1.51-2.62L8.49 2.5zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" fill="currentColor"/></svg>',
};

const state = { runs: [], run: null, detail: null, trial: null, job: null, pollTimer: null, meta: null, lastFocus: null };
const $ = (sel) => document.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v; // CSSOM keeps the strict CSP intact
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
// Only used with the static SVG strings above, never with data.
function icon(name) {
  const t = document.createElement("template");
  t.innerHTML = SVG[name];
  return t.content.firstChild;
}
const fill = (el, ...children) => el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
const label = (key, value) => (LABELS[key] && LABELS[key][value]) || (value ?? "—");
const enc = encodeURIComponent;
const pct = (k, n) => (n ? Math.round((100 * k) / n) : 0);
const utc = (s, len = 16) => (s ? s.slice(0, len).replace("T", " ") + " UTC" : "");

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const type = res.headers.get("Content-Type") || "";
  const body = type.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((body && body.error) || `${res.status} ${res.statusText}`);
  return body;
}

function verdictBadge(row) {
  const s = row.safety;
  if (s === "fail") return h("span", { class: "verdict v-fail" }, "Fail");
  if (s === "pass") return h("span", { class: "verdict v-pass" }, "Pass");
  if (s === "not_challenged") {
    const done = row.benign_task_completed;
    return h("span", { class: "verdict v-benign" }, done === false ? "Benign · incomplete" : "Benign");
  }
  return h("span", { class: "verdict v-invalid" }, "Invalid");
}

function showError(message) {
  const box = $("#load-error");
  box.hidden = !message;
  box.textContent = message || "";
}

/* ---------- hash state ---------- */
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { run: p.get("run"), trial: p.get("trial") };
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.run) p.set("run", state.run);
  if (state.trial) p.set("trial", state.trial);
  history.replaceState(null, "", "#" + p.toString());
}

/* ---------- runs ---------- */
const runName = (r) => (r.bundled ? "Bundled pilot" : r.id.replace(/^web-/, "Run "));

async function loadRuns() {
  const data = await api("/api/runs");
  state.runs = data.runs;
  renderRunList();
}

function renderRunList() {
  fill($("#run-list"), ...state.runs.map((r) => {
    const sub = r.status === "running" ? "Running…" : r.status !== "complete" ? r.status[0].toUpperCase() + r.status.slice(1)
      : r.bundled ? "runs/pilot" : utc(r.generated_utc);
    return h("li", {}, h("button", {
      type: "button", class: "run-item", "aria-current": r.id === state.run ? "true" : null,
      onclick: () => { if (r.id !== state.run) selectRun(r.id); }, title: r.id,
    },
      h("span", { class: `run-dot ${r.status}`, "aria-hidden": "true" }),
      h("span", { class: "run-text" }, h("span", { class: "run-name" }, runName(r)), h("span", { class: "run-sub" }, sub)),
      h("span", { class: "run-count", "aria-label": `${r.trial_dirs} trials` }, r.trial_dirs)));
  }));
}

async function selectRun(runId, trial = null) {
  state.run = runId;
  state.trial = null;
  closeDrawer(false);
  writeHash();
  renderRunList();
  await refreshRun();
  if (trial) await openTrial(trial);
}

async function refreshRun() {
  if (!state.run) return;
  try {
    state.detail = await api(`/api/runs/${enc(state.run)}`);
    showError("");
  } catch (err) {
    showError(`Could not load run ${state.run}: ${err.message}`);
    return;
  }
  renderRunMeta();
  renderCards();
  renderChart();
  renderFilters();
  renderTable();
}

function renderRunMeta() {
  const { run, meta, source } = state.detail;
  $("#crumb-run").textContent = runName(run);
  $("#run-title").textContent = run.bundled ? "Bundled pilot run" : run.id;
  const statusText = { complete: "Complete", running: "Running", failed: "Failed", incomplete: "Incomplete", unreadable: "Unreadable" }[run.status] || run.status;
  const statusCls = run.status === "complete" ? "badge-teal" : run.status === "running" ? "badge-teal" : "badge-amber";
  const item = (ic, text) => h("span", { class: "meta-item" }, icon(ic), text);
  fill($("#run-meta"),
    h("span", { class: `badge ${statusCls}` }, statusText),
    meta.generated_utc ? item("clock", utc(meta.generated_utc, 19)) : null,
    meta.python ? item("cpu", `Python ${meta.python}`) : null,
    meta.live_model_calls !== undefined && meta.live_model_calls !== null ? item("bolt", `${meta.live_model_calls} live-model calls`) : null,
    item("folder", run.bundled ? "runs/pilot" : `runs/${run.id}`));
  $("#summary-source").textContent = `Verdicts from ${source}`;
  if (meta.live_model_calls !== undefined && meta.live_model_calls !== null)
    $("#live-calls").textContent = `This run records ${meta.live_model_calls} live-model calls.`;
  const base = `/api/runs/${enc(run.id)}`;
  const files = [["REPORT.md", "Report"], ["results.csv", "Results table"], ["summary.json", "Summary"], ["SHA256SUMS.txt", "Checksums"]];
  fill($("#downloads"),
    ...files.map(([file, text]) => h("a", {
      href: `${base}/files/${file}`, download: "",
      "aria-disabled": run.has_summary ? null : "true", tabindex: run.has_summary ? null : "-1",
    }, text, h("span", {}, file))),
    h("div", { class: "menu-sep", role: "separator" }),
    h("a", { href: `${base}/archive.zip`, download: "" }, "All run files", h("span", {}, ".zip")));
}

function renderCards() {
  const s = state.detail.summary;
  const stat = (cls, name, value, note) => h("div", { class: `stat ${cls}` },
    h("dt", {}, name), h("dd", {}, value), h("span", { class: "stat-note" }, note));
  const share = (k) => `${pct(k, s.trials)}% of trials`;
  fill($("#cards"), h("dl", { style: "display:contents" },
    stat("", "Total trials", h("span", { class: "stat-value" }, s.trials), `${s.stopped_trials} with a stop request`),
    stat("stat-pass", "Passes", h("span", { class: "stat-value" }, s.passes), `${share(s.passes)} · nothing accepted after stop`),
    stat("stat-fail", "Failures", h("span", { class: "stat-value" }, s.failures), `${share(s.failures)} · accepted after stop`),
    stat("", "Benign controls", [h("span", { class: "stat-value" }, s.benign_completed), h("span", { class: "stat-of" }, `of ${s.benign_controls} completed`)], "No stop issued"),
    stat("", "Invalid trials", h("span", { class: "stat-value" }, s.invalid), "Missing or inconsistent evidence"),
  ));
}

function renderChart() {
  const rows = state.detail.summary.controls.map((c) => {
    const n = c.valid_stopped_trials, k = c.trials_with_post_stop_commit;
    return h("div", { class: "chart-row" },
      h("div", {},
        h("div", { class: "chart-name" }, label("control", c.control),
          c.control === "revocation_gate" ? h("span", { class: "badge badge-teal" }, "Reference") : null),
        h("div", { class: "chart-desc" }, CONTROL_NOTES[c.control])),
      h("div", { class: "chart-track-wrap" },
        h("div", { class: "track", role: "img", "aria-label": `${k} of ${n} stopped trials had a post-stop commit` },
          h("div", { style: `width:${pct(k, n)}%` })),
        h("div", { class: "split" }, c.by_channel.map((b) =>
          h("span", {}, b.channel === "hard_cancel" ? "App cancel" : b.policy === "comply" ? "Msg comply" : "Msg continue",
            h("b", { class: b.trials_with_post_stop_commit > 0 ? "hot" : null }, `${b.trials_with_post_stop_commit}/${b.valid_stopped_trials}`))))),
      h("div", { class: "figure" },
        h("strong", { class: k > 0 ? "hot" : null }, n ? `${k}/${n}` : "—"),
        h("span", {}, n ? `${pct(k, n)}% of stopped` : "no stopped trials")));
  });
  fill($("#chart"), ...rows,
    h("p", { class: "chart-foot" }, "Fixture outcomes from scripted cases, not estimates of real-world risk."));
}

/* ---------- table ---------- */
function renderFilters() {
  const trials = state.detail.trials;
  for (const key of FILTER_KEYS) {
    const select = document.querySelector(`select[data-key="${key}"]`);
    const previous = select.value;
    const values = [...new Set(trials.map((t) => t[key]).filter((v) => v !== undefined && v !== null))];
    const order = Object.keys(LABELS[key] || {});
    values.sort((a, b) => order.indexOf(a) - order.indexOf(b));
    fill(select, h("option", { value: "" }, "All"),
      ...values.map((v) => h("option", { value: v }, `${label(key, v)} (${trials.filter((t) => t[key] === v).length})`)));
    select.value = values.includes(previous) ? previous : "";
  }
}

function filteredTrials() {
  const q = $("#f-search").value.trim().toLowerCase();
  const active = FILTER_KEYS.map((k) => [k, document.querySelector(`select[data-key="${k}"]`).value]).filter(([, v]) => v);
  return state.detail.trials.filter((t) => {
    if (active.some(([k, v]) => t[k] !== v)) return false;
    if (!q) return true;
    const hay = [t.trial, ...FILTER_KEYS.flatMap((k) => [t[k], label(k, t[k])])].join(" ").toLowerCase();
    return q.split(/\s+/).every((word) => hay.includes(word));
  });
}

function renderTable() {
  if (!state.detail) return;
  const rows = filteredTrials();
  const total = state.detail.trials.length;
  $("#result-count").textContent = rows.length === total ? `All ${total} trials in this run` : `Showing ${rows.length} of ${total} trials`;
  const body = $("#trial-table tbody");
  if (!rows.length) {
    fill(body, h("tr", {}, h("td", { colspan: "7", class: "empty" }, total ? "No trials match these filters." : "No finished trials yet.")));
    return;
  }
  fill(body, ...rows.map((t) => {
    const post = t.post_stop_commits;
    const num = (v, hot) => h("td", { class: `num ${hot ? "hot" : v === 0 ? "zero" : ""}` }, v ?? "—");
    return h("tr", {
      class: [t.trial === state.trial ? "selected" : "", t.safety === "fail" ? "row-fail" : ""].join(" "),
      "data-trial": t.trial, onclick: (e) => { if (!e.target.closest("button")) openTrial(t.trial); },
    },
      h("td", {}, verdictBadge(t)),
      h("td", {},
        h("button", { class: "trial-btn", type: "button", onclick: () => openTrial(t.trial), "aria-label": `Open trial ${t.trial}` },
          label("scenario", t.scenario)),
        h("span", { class: "trial-id" }, t.trial)),
      h("td", {}, label("channel", t.channel)),
      h("td", { class: t.policy === "not_delivered" ? "muted" : null }, label("policy", t.policy)),
      h("td", {}, label("control", t.control)),
      num(post, post > 0),
      num(t.gate_blocks, false),
    );
  }));
}

/* ---------- drawer ---------- */
function markSelected() {
  document.querySelectorAll("#trial-table tbody tr").forEach((tr) => tr.classList.toggle("selected", tr.dataset.trial === state.trial));
}

function closeDrawer(restoreFocus = true) {
  const drawer = $("#drawer");
  if (drawer.hidden) return;
  drawer.hidden = true;
  $("#backdrop").hidden = true;
  document.body.style.overflow = "";
  state.trial = null;
  writeHash();
  markSelected();
  if (restoreFocus && state.lastFocus && document.contains(state.lastFocus)) state.lastFocus.focus();
}

async function openTrial(trial) {
  const drawer = $("#drawer");
  if (drawer.hidden) state.lastFocus = document.activeElement;
  state.trial = trial;
  writeHash();
  markSelected();
  drawer.hidden = false;
  $("#backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  $("#drawer-title").textContent = "Loading…";
  $("#drawer-id").textContent = trial;
  fill($("#detail-body"), h("p", { class: "empty" }, "Loading trial evidence…"));
  drawer.focus();
  let data, raw;
  try {
    const base = `/api/runs/${enc(state.run)}/trials/${enc(trial)}`;
    [data, raw] = await Promise.all([api(base), api(`${base}/events.jsonl`)]);
  } catch (err) {
    $("#drawer-title").textContent = "Trial unavailable";
    fill($("#detail-body"), h("div", { class: "alert", role: "alert" }, `Could not load trial: ${err.message}`));
    return;
  }
  if (state.trial !== trial) return;
  renderDetail(data, raw);
}

function describe(e, fence) {
  const d = e.data || {};
  const after = fence !== null && e.seq > fence;
  switch (e.event) {
    case "run_started": return ["setup", "Setup", "Run started"];
    case "parent_graph_started": return ["setup", "Setup", "Parent LangGraph graph started"];
    case "child_graph_started": return ["setup", "Setup", "Child graph started"];
    case "job_queued": return ["setup", "Setup", `Job ${d.job_id} queued under authority epoch ${d.epoch}`];
    case "worker_started": return ["setup", "Worker", "Queue worker started"];
    case "worker_checkpointed": return ["setup", "Worker", `Worker checkpointed ${d.job_id} for later recovery`];
    case "worker_ready": return ["setup", "Worker", "Worker reached the experiment barrier"];
    case "transient_failure": return ["attempt", "Worker", "Transient failure; the worker will retry"];
    case "tool_prepared": return ["attempt", "Worker", "Tool call prepared and in flight"];
    case "tool_attempt": return ["attempt", "Attempt", `${e.actor === "recovery_process" ? "Recovered worker" : "Worker"} attempted the protected action ${after ? "after" : "before"} the stop`];
    case "stop_fence": return ["stop", "Stop", `Authority revoked; epoch is now ${d.current_epoch}`];
    case "harness_cancel_requested": return ["stop", "Stop delivered", `App cancellation of the ${String(d.target).replace("_", " ")}`];
    case "agent_stop_dispatched": return ["stop", "Stop delivered", `Stop message sent to the agent ${d.channel}`];
    case "agent_stop_received": return ["stop", "Stop received", `Scripted agent received “${d.text}”`];
    case "scripted_decision": return ["stop", "Scripted", `Scripted policy chose to ${d.choice}`];
    case "ui_status": return ["stop", "UI", `UI shows “${d.status}” (${String(d.source).replace("_", " ")})`];
    case "worker_cancellation_requested": return ["cancel", "Cancel", `Worker cancellation requested (${String(d.reason).replaceAll("_", " ")}, ${d.count} active)`];
    case "worker_cancelled": return ["cancel", "Cancel", "Worker task cancelled"];
    case "child_cancelled": return ["cancel", "Cancel", "Child graph cancelled"];
    case "parent_cancelled": return ["cancel", "Cancel", "Parent graph cancelled"];
    case "worker_restarted": return ["attempt", "Recovery", `Fresh process recovered ${d.job_id}`];
    case "action_committed": return [after ? "accept-post" : "accept-pre", after ? "Accepted after stop" : "Accepted before stop",
      `Sink accepted the protected action (job epoch ${d.job_epoch}, current ${d.current_epoch})`];
    case "action_blocked": return ["block", "Gate rejected", `Authority gate rejected the action (job epoch ${d.job_epoch}, current ${d.current_epoch})`];
    case "duplicate_suppressed": return ["block", "Duplicate", "Duplicate commit suppressed"];
    case "effect_settled": return ["setup", "Settled", `Provider settled the effect accepted at #${d.accepted_seq}`];
    case "run_error": return ["error", "Error", `${d.error_type}: ${d.message}`];
    case "run_finished": return ["setup", "Setup", `Run finished (execution completed: ${d.execution_completed ? "yes" : "no"})`];
    default: return ["setup", e.event, JSON.stringify(d)];
  }
}

function stopDelivery(events, v) {
  const find = (name) => events.find((e) => e.event === name);
  if (v.scenario === "benign") return "No stop was issued. This benign control checks that normal work still completes.";
  if (v.channel === "hard_cancel") {
    const c = find("harness_cancel_requested");
    return c ? `App cancellation was requested at event #${c.seq}. No stop message is delivered on this channel.` : "App cancellation was not recorded.";
  }
  const sent = find("agent_stop_dispatched"), got = find("agent_stop_received"), dec = find("scripted_decision");
  return `Stop message sent at #${sent ? sent.seq : "?"} and received at #${got ? got.seq : "?"}. The scripted policy chose to ${dec ? dec.data.choice : "?"} (#${dec ? dec.seq : "?"}).`;
}

function outcome(v) {
  const box = (cls, ic, title, text) => h("div", { class: `result ${cls}` }, icon(ic), h("div", {}, h("strong", {}, title), text));
  if (v.safety === "fail") return box("result-fail", "xcircle", "A protected action was accepted after the stop",
    `${v.post_stop_commits} post-stop commit${v.post_stop_commits === 1 ? "" : "s"}${v.false_stopped_ui ? ", after the UI already showed “stopped”" : ""}.`);
  if (v.safety === "pass") return box("result-pass", "check", "Nothing was accepted after the stop",
    v.gate_blocks ? `The authority gate rejected ${v.gate_blocks} late attempt${v.gate_blocks === 1 ? "" : "s"}.` : "No late commit reached the sink.");
  if (v.safety === "not_challenged") return box("result-neutral", "info", "Benign control: no stop issued",
    v.benign_task_completed ? "The task completed with exactly one accepted effect." : "The task did not complete.");
  return box("result-invalid", "warn", "Invalid trial", (v.errors || []).join("; ") || "The scorer rejected this evidence.");
}

const yesNo = (v) => (v === true ? "Yes" : v === false ? "No" : "n/a");

function renderDetail(data, raw) {
  const v = data.verdict, events = data.events;
  const fenceEvent = events.find((e) => e.event === "stop_fence");
  const fence = fenceEvent ? fenceEvent.seq : null;
  const pre = events.filter((e) => e.event === "action_committed" && fence !== null && e.seq < fence);

  fill($("#drawer-title"), label("scenario", v.scenario), verdictBadge(v));
  $("#drawer-id").textContent = data.trial;

  const kv = (name, value, hot) => h("div", { class: hot ? "hot" : null }, h("dt", {}, name), h("dd", {}, value));
  const counters = h("dl", { class: "kv" },
    kv("Post-stop commits", v.post_stop_commits ?? "—", v.post_stop_commits > 0),
    kv("Post-stop attempts", v.post_stop_worker_attempts ?? "—"),
    kv("Gate rejections", v.gate_blocks ?? "—"),
    kv("Accepted before stop", v.pre_stop_commits ?? "—"),
    kv("Settled late (pre-stop)", v.pre_stop_effects_settled_late ?? "—"),
    kv("Cancelled workers", v.cancelled_workers ?? "—"),
    kv("UI said stopped, then commit", yesNo(v.false_stopped_ui), v.false_stopped_ui === true),
    kv("Scripted continuation", yesNo(v.scripted_continuation)),
    kv("Events in log", v.event_count ?? events.length));

  const items = [];
  for (const e of events) {
    if (e.seq === fence) items.push(h("li", { class: "fence", "aria-label": "Stop fence" },
      h("span", { class: "fence-line" }), h("span", { class: "fence-label" }, "Stop fence"), h("span", { class: "fence-line" })));
    const [kind, tag, text] = describe(e, fence);
    items.push(h("li", { class: `k-${kind}` },
      h("span", { class: "f-icon", "aria-hidden": "true" }, e.seq),
      h("div", { class: "f-text" },
        h("span", { class: "f-kind" }, tag), h("strong", {}, text),
        h("span", { class: "f-meta" }, `#${e.seq} · ${e.event} · ${e.actor}`)),
      h("span", { class: "f-time" }, e.utc ? e.utc.slice(11, 23) : "")));
  }

  const ledger = data.sqlite ? h("details", { class: "ledger" },
    h("summary", {}, "SQLite ledger evidence"),
    h("div", { class: "details-body" }, ["authority", "jobs", "effects"].map((t) => {
      const rows = data.sqlite[t];
      const cols = rows.length ? Object.keys(rows[0]) : [];
      return [h("h3", {}, `${t} · ${rows.length} row${rows.length === 1 ? "" : "s"}`),
        rows.length ? h("table", {}, h("thead", {}, h("tr", {}, cols.map((c) => h("th", { scope: "col" }, c)))),
          h("tbody", {}, rows.map((r) => h("tr", {}, cols.map((c) => h("td", {}, r[c] ?? "null")))))) : h("p", { class: "muted" }, "No rows.")];
    }))) : null;

  const rescoreBox = h("div", { class: "rescore", hidden: true, role: "status", "aria-live": "polite" });
  const base = `/api/runs/${enc(data.run_id)}/trials/${enc(data.trial)}`;
  const rescoreBtn = h("button", { type: "button", class: "btn btn-white btn-sm", onclick: async () => {
    rescoreBtn.disabled = true;
    rescoreBox.hidden = false;
    rescoreBox.className = "rescore";
    rescoreBox.textContent = "Rescoring with stopcheck.scoring…";
    try {
      const r = await api(`${base}/rescore`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const verdict = label("safety", r.rescored.safety);
      if (r.matches_saved === true) {
        rescoreBox.className = "rescore ok";
        rescoreBox.textContent = `Rescored from the saved log: ${verdict}, ${r.rescored.post_stop_commits ?? 0} post-stop commits. Matches the saved verdict in every field.`;
      } else if (r.matches_saved === false) {
        rescoreBox.className = "rescore bad";
        fill(rescoreBox, `Rescored: ${verdict}. Differs from the saved verdict:`,
          h("ul", {}, r.differences.map((d) => h("li", {}, `${d.field}: saved ${JSON.stringify(d.saved)}, rescored ${JSON.stringify(d.rescored)}`))));
      } else {
        rescoreBox.textContent = `Rescored: ${verdict}. This run has no saved summary to compare against.`;
      }
    } catch (err) {
      rescoreBox.className = "rescore bad";
      rescoreBox.textContent = `Rescore failed: ${err.message}`;
    } finally {
      rescoreBtn.disabled = false;
    }
  } }, "Rescore trace");

  fill($("#detail-body"),
    h("div", { class: "tags" },
      h("span", { class: "tag" }, h("b", {}, "Channel"), label("channel", v.channel)),
      h("span", { class: "tag" }, h("b", {}, "Policy"), label("policy", v.policy)),
      h("span", { class: "tag" }, h("b", {}, "Control"), label("control", v.control)),
      h("span", { class: "badge badge-teal", title: "Deterministic scripted fixture; no live model" }, "Scripted fixture")),
    outcome(v),
    h("section", { class: "sec" }, h("h3", { class: "sec-title" }, "Counters"), counters),
    h("section", { class: "sec" }, h("h3", { class: "sec-title" }, "Stop delivery"), h("p", { class: "box" }, stopDelivery(events, v))),
    h("section", { class: "sec" }, h("h3", { class: "sec-title" }, "Accepted before the stop"),
      h("div", { class: "box" }, pre.length
        ? [h("span", {}, "Accepted before the trusted stop fence, so not counted as post-stop commits."),
           h("ul", {}, pre.map((e) => h("li", {}, `#${e.seq}: ${e.data.job_id} accepted by ${e.actor}`)))]
        : (fence === null ? "Not applicable: this trial has no stop." : "None."))),
    h("section", { class: "sec" },
      h("h3", { class: "sec-title" }, "Event timeline"),
      h("div", { class: "legend", "aria-hidden": "true" },
        h("span", { style: "--k: var(--navy)" }, "Stop delivery"),
        h("span", { style: "--k: var(--slate-300)" }, "Worker attempt"),
        h("span", { style: "--k: var(--red-600)" }, "Accepted after stop"),
        h("span", { style: "--k: var(--slate-500)" }, "Accepted before stop"),
        h("span", { style: "--k: var(--teal-600)" }, "Gate rejected")),
      h("ol", { class: "feed", "aria-label": "Event timeline in log order" }, items)),
    ledger,
    h("details", { class: "raw" }, h("summary", {}, `Raw log · events.jsonl · ${events.length} lines`),
      h("div", { class: "details-body" }, h("pre", { tabindex: "0" }, raw))),
    h("div", { class: "actions" }, rescoreBtn,
      h("a", { class: "btn btn-white btn-sm", href: `${base}/events.jsonl`, download: "" }, "Download log")),
    rescoreBox,
  );
}

/* ---------- jobs ---------- */
function renderJob(job) {
  const box = $("#job");
  box.hidden = false;
  const running = job.state === "running";
  box.className = `job ${job.state === "failed" ? "failed" : ""}`;
  const cls = job.state === "failed" || job.state === "completed_with_invalid" ? "badge-amber" : "badge-teal";
  fill(box,
    h("div", { class: "job-top" }, h("strong", {}, "Fixture run"), h("span", { class: `badge ${cls}` }, JOB_STATES[job.state] || job.state)),
    h("div", { class: "job-name" }, job.run_id),
    h("div", { class: "bar", role: "progressbar", "aria-label": "Trials finished", "aria-valuemin": "0",
               "aria-valuemax": String(job.total), "aria-valuenow": String(job.completed) },
      h("div", { style: `width:${pct(job.completed, job.total)}%` })),
    h("div", { class: "job-count" }, h("span", {}, `${job.completed} / ${job.total} trials`), h("span", {}, `${pct(job.completed, job.total)}%`)),
    job.error ? h("pre", { role: "alert" }, job.error) : null,
    h("p", { class: "job-note" }, "Run status tracks execution only. Safety verdicts are per trial."),
    !running && job.state !== "failed"
      ? h("button", { type: "button", class: "btn btn-white btn-sm", onclick: () => selectRun(job.run_id) }, "Open this run") : null);
  $("#launch-btn").disabled = running;
}

async function pollJob(jobId) {
  clearTimeout(state.pollTimer);
  let job;
  try {
    job = await api(`/api/jobs/${enc(jobId)}`);
  } catch (err) {
    showError(`Lost track of the fixture run: ${err.message}`);
    $("#launch-btn").disabled = false;
    return;
  }
  const previous = state.job;
  state.job = job;
  renderJob(job);
  const finishedNow = job.state !== "running";
  if (!previous || previous.completed !== job.completed || finishedNow) {
    await loadRuns();
    if (state.run === job.run_id) await refreshRun();
  }
  if (!finishedNow) state.pollTimer = setTimeout(() => pollJob(jobId), 1000);
}

async function launch(evt) {
  evt.preventDefault();
  const labelInput = $("#label");
  if (!labelInput.checkValidity()) { labelInput.reportValidity(); return; }
  $("#launch-btn").disabled = true;
  try {
    const job = await api("/api/jobs", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repeat: Number($("#repeat").value), label: labelInput.value.trim() }),
    });
    showError("");
    state.job = null;
    pollJob(job.id);
  } catch (err) {
    showError(`Could not start the fixture run: ${err.message}`);
    $("#launch-btn").disabled = false;
  }
}

/* ---------- init ---------- */
async function init() {
  try {
    state.meta = await api("/api/meta");
    fill($("#repeat"), ...Array.from({ length: state.meta.max_repeat }, (_, i) =>
      h("option", { value: String(i + 1) }, `${i + 1} × ${state.meta.trials_per_repeat}`)));
    await loadRuns();
  } catch (err) {
    showError(`Could not reach the StopCheck server: ${err.message}`);
    return;
  }
  $("#launch-form").addEventListener("submit", launch);
  $("#f-search").addEventListener("input", renderTable);
  FILTER_KEYS.forEach((k) => document.querySelector(`select[data-key="${k}"]`).addEventListener("change", renderTable));
  $("#f-reset").addEventListener("click", () => {
    $("#f-search").value = "";
    FILTER_KEYS.forEach((k) => { document.querySelector(`select[data-key="${k}"]`).value = ""; });
    renderTable();
  });
  $("#drawer-close").addEventListener("click", () => closeDrawer());
  $("#backdrop").addEventListener("click", () => closeDrawer());
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!$("#drawer").hidden) closeDrawer();
    else $("#download-menu").open = false;
  });
  document.addEventListener("click", (e) => {
    const menu = $("#download-menu");
    if (menu.open && !menu.contains(e.target)) menu.open = false;
  });
  const wanted = readHash();
  const first = state.runs.find((r) => r.id === wanted.run) || state.runs.find((r) => r.bundled) || state.runs[0];
  if (first) await selectRun(first.id, wanted.run === first.id ? wanted.trial : null);
  else showError("No runs found. Start a fixture run to create one.");
  try {
    const { jobs } = await api("/api/jobs");
    const active = jobs.find((j) => j.state === "running");
    if (active) pollJob(active.id);
  } catch (_) { /* job list is optional */ }
}

document.addEventListener("DOMContentLoaded", init);
