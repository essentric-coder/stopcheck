import type { RunInfo, TraceEvent, TrialRow } from "@/lib/api"

export const LABELS: Record<string, Record<string, string>> = {
  channel: { hard_cancel: "App cancellation", agent_message: "Agent stop message" },
  policy: { not_delivered: "Not delivered", comply: "Scripted: comply", continue: "Scripted: continue" },
  control: { cancel_only: "Basic stop", cascade: "Cascade cancel", revocation_gate: "Authority gate" },
  scenario: {
    queued: "Queued job", in_flight: "In-flight call", retry: "Retry", restart: "Restart / recovery",
    precommitted: "Pre-committed", benign: "Benign (no stop)",
  },
  safety: { fail: "Fail", pass: "Pass", not_challenged: "Benign", invalid: "Invalid" },
}

export const CONTROL_NOTES: Record<string, string> = {
  cancel_only: "Cancels the graph; a complying agent cancels its worker.",
  cascade: "Also cancels live workers from the stop handler.",
  revocation_gate: "Reference control: the sink re-checks persisted authority at commit.",
}

export function label(key: string, value: string | undefined | null): string {
  if (value === undefined || value === null) return "—"
  return LABELS[key]?.[value] ?? value
}

export const ORDER = (key: string) => Object.keys(LABELS[key] ?? {})

export function runName(r: Pick<RunInfo, "id" | "bundled">): string {
  return r.bundled ? "Bundled pilot" : r.id.replace(/^web-/, "Run ")
}

export function formatUtc(value: string | null | undefined, length = 16): string {
  return value ? value.slice(0, length).replace("T", " ") + " UTC" : ""
}

export const pct = (k: number, n: number) => (n ? Math.round((100 * k) / n) : 0)

export type EventKind = "setup" | "stop" | "cancel" | "attempt" | "accept-pre" | "accept-post" | "block" | "error"

/** Plain-language description of a trace event, relative to the stop fence. */
export function describe(e: TraceEvent, fence: number | null): { kind: EventKind; tag: string; text: string } {
  const d = e.data as Record<string, string | number | boolean>
  const after = fence !== null && e.seq > fence
  const s = (v: unknown) => String(v).replaceAll("_", " ")
  switch (e.event) {
    case "run_started": return { kind: "setup", tag: "Setup", text: "Run started" }
    case "parent_graph_started": return { kind: "setup", tag: "Setup", text: "Parent LangGraph graph started" }
    case "child_graph_started": return { kind: "setup", tag: "Setup", text: "Child graph started" }
    case "job_queued": return { kind: "setup", tag: "Setup", text: `Job ${d.job_id} queued under authority epoch ${d.epoch}` }
    case "worker_started": return { kind: "setup", tag: "Worker", text: "Queue worker started" }
    case "worker_checkpointed": return { kind: "setup", tag: "Worker", text: `Worker checkpointed ${d.job_id} for later recovery` }
    case "worker_ready": return { kind: "setup", tag: "Worker", text: "Worker reached the experiment barrier" }
    case "transient_failure": return { kind: "attempt", tag: "Worker", text: "Transient failure; the worker will retry" }
    case "tool_prepared": return { kind: "attempt", tag: "Worker", text: "Tool call prepared and in flight" }
    case "tool_attempt": return {
      kind: "attempt", tag: "Worker attempt",
      text: `${e.actor === "recovery_process" ? "Recovered worker" : "Worker"} attempted the protected action ${after ? "after" : "before"} the stop`,
    }
    case "stop_fence": return { kind: "stop", tag: "Stop", text: `Authority revoked; epoch is now ${d.current_epoch}` }
    case "harness_cancel_requested": return { kind: "stop", tag: "Stop delivered", text: `App cancellation of the ${s(d.target)}` }
    case "agent_stop_dispatched": return { kind: "stop", tag: "Stop delivered", text: `Stop message sent to the agent ${d.channel}` }
    case "agent_stop_received": return { kind: "stop", tag: "Stop received", text: `Scripted agent received “${d.text}”` }
    case "scripted_decision": return { kind: "stop", tag: "Scripted", text: `Scripted policy chose to ${d.choice}` }
    case "ui_status": return { kind: "stop", tag: "UI", text: `UI shows “${d.status}” (${s(d.source)})` }
    case "worker_cancellation_requested": return { kind: "cancel", tag: "Cancel", text: `Worker cancellation requested (${s(d.reason)}, ${d.count} active)` }
    case "worker_cancelled": return { kind: "cancel", tag: "Cancel", text: "Worker task cancelled" }
    case "child_cancelled": return { kind: "cancel", tag: "Cancel", text: "Child graph cancelled" }
    case "parent_cancelled": return { kind: "cancel", tag: "Cancel", text: "Parent graph cancelled" }
    case "worker_restarted": return { kind: "attempt", tag: "Recovery", text: `Fresh process recovered ${d.job_id}` }
    case "action_committed": return {
      kind: after ? "accept-post" : "accept-pre", tag: after ? "Accepted after stop" : "Accepted before stop",
      text: `Sink accepted the protected action (job epoch ${d.job_epoch}, current ${d.current_epoch})`,
    }
    case "action_blocked": return { kind: "block", tag: "Gate rejected", text: `Authority gate rejected the action (job epoch ${d.job_epoch}, current ${d.current_epoch})` }
    case "duplicate_suppressed": return { kind: "block", tag: "Duplicate", text: "Duplicate commit suppressed" }
    case "effect_settled": return { kind: "setup", tag: "Settled", text: `Provider settled the effect accepted at #${d.accepted_seq}` }
    case "run_error": return { kind: "error", tag: "Error", text: `${d.error_type}: ${d.message}` }
    case "run_finished": return { kind: "setup", tag: "Setup", text: `Run finished (execution completed: ${d.execution_completed ? "yes" : "no"})` }
    default: return { kind: "setup", tag: e.event, text: JSON.stringify(d) }
  }
}

export function stopDelivery(events: TraceEvent[], v: TrialRow): string {
  const find = (name: string) => events.find((e) => e.event === name)
  if (v.scenario === "benign") return "No stop was issued. This benign control checks that normal work still completes."
  if (v.channel === "hard_cancel") {
    const c = find("harness_cancel_requested")
    return c ? `App cancellation was requested at event #${c.seq}. No stop message is delivered on this channel.` : "App cancellation was not recorded."
  }
  const sent = find("agent_stop_dispatched"), got = find("agent_stop_received"), dec = find("scripted_decision")
  return `Stop message sent at #${sent?.seq ?? "?"} and received at #${got?.seq ?? "?"}. The scripted policy chose to ${String(dec?.data.choice ?? "?")} (#${dec?.seq ?? "?"}).`
}
