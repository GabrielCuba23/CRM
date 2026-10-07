import { buildRuleTasks, ruleTask, fingerprint } from "../automation.mjs";
import { emptyState } from "./state.mjs";
async function read(db) {
  const row = await db
    .prepare("SELECT revision,body FROM workspace WHERE id=1")
    .first();
  return row
    ? { state: JSON.parse(row.body), revision: row.revision }
    : { state: emptyState(), revision: 0 };
}
export async function generateTasks(
  env,
  { now = new Date(), limit = 10 } = {},
) {
  const { state, revision } = await read(env.DB),
    tasks = await buildRuleTasks(state, { now }),
    timestamp = Math.floor(now.getTime() / 1000);
  const previous = await env.DB.prepare(
    "SELECT id,signature,state FROM message_tasks WHERE state != ? LIMIT 10000",
  )
    .bind("cancelled")
    .all();
  const map = new Map(previous.results.map((t) => [t.id, t]));
  let count = 0;
  for (const task of tasks) {
    const prior = map.get(task.id);
    if (
      prior &&
      [
        "claimed",
        "processing",
        "completed",
        "accepted",
        "uncertain",
        "rejected",
      ].includes(prior.state)
    )
      continue;
    if (prior?.signature === task.signature) continue;
    const row = await env.DB.prepare(
      "INSERT INTO message_tasks(id,signature,body,state,created,updated) SELECT ?,?,?,'pending',?,? WHERE (SELECT revision FROM workspace WHERE id=1)=? ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,body=excluded.body,state='pending',updated=excluded.updated,error=NULL WHERE message_tasks.state IN ('pending','cancelled','rate_limited') RETURNING id",
    )
      .bind(
        task.id,
        task.signature,
        JSON.stringify(task),
        timestamp,
        timestamp,
        revision,
      )
      .first();
    if (row && ++count >= limit) break;
  }
  return count;
}
async function validTask(env, row, now) {
  const { state, revision } = await read(env.DB),
    task = JSON.parse(row.body),
    rule = state.rules?.find((r) => r.id === task.ruleId),
    client = state.clients.find((c) => c.id === task.clientId);
  const current =
    rule && client ? await ruleTask(state, rule, client, { now }) : null;
  if (!current || current.signature !== row.signature) {
    await env.DB.prepare(
      "UPDATE message_tasks SET state='cancelled',error='changed_or_inactive' WHERE id=? AND state IN ('pending','rate_limited')",
    )
      .bind(row.id)
      .run();
    return null;
  }
  return { task: current, state, revision };
}
export async function claimTasks(env, { now = new Date(), limit = 10 } = {}) {
  const timestamp = Math.floor(now.getTime() / 1000);
  const rows = await env.DB.prepare(
      "SELECT * FROM message_tasks WHERE state='pending' AND json_extract(body,'$.delivery')='integration' ORDER BY created,id LIMIT 10",
    ).all(),
    tasks = [];
  for (const row of rows.results) {
    if (JSON.parse(row.body).delivery !== "integration") continue;
    const valid = await validTask(env, row, now);
    if (!valid) continue;
    const claimToken = crypto.randomUUID() + crypto.randomUUID(),
      hash = await fingerprint(claimToken);
    const claim = await env.DB.prepare(
      "UPDATE message_tasks SET state='claimed',claim_hash=?,updated=? WHERE id=? AND signature=? AND state='pending' AND (SELECT revision FROM workspace WHERE id=1)=? RETURNING id",
    )
      .bind(hash, timestamp, row.id, row.signature, valid.revision)
      .first();
    if (claim) tasks.push({ ...valid.task, claimToken });
    if (tasks.length >= limit) break;
  }
  return tasks;
}
export async function acknowledgeTask(env, input, { now = new Date() } = {}) {
  if (
    !input ||
    typeof input.id !== "string" ||
    input.id.length > 25000 ||
    typeof input.claimToken !== "string" ||
    input.claimToken.length > 200 ||
    !["completed", "failed", "uncertain"].includes(input.status) ||
    (input.providerId !== undefined &&
      (typeof input.providerId !== "string" || input.providerId.length > 300))
  )
    throw Error("Confirmación no válida.");
  const hash = await fingerprint(input.claimToken),
    row = await env.DB.prepare(
      "SELECT state,claim_hash FROM message_tasks WHERE id=?",
    )
      .bind(input.id)
      .first();
  if (!row || row.claim_hash !== hash) return false;
  const desired = input.status === "failed" ? "rejected" : input.status;
  if (row.state === desired) return true;
  const result = await env.DB.prepare(
    "UPDATE message_tasks SET state=?,updated=?,provider_id=?,error=? WHERE id=? AND state='claimed' AND claim_hash=? RETURNING id",
  )
    .bind(
      desired,
      Math.floor(now.getTime() / 1000),
      input.providerId || null,
      input.status === "failed"
        ? "integration_failed"
        : input.status === "uncertain"
          ? "integration_uncertain"
          : null,
      input.id,
      hash,
    )
    .first();
  return Boolean(result);
}
export async function integrationAuthenticated(request, env) {
  if (!env.INTEGRATION_API_TOKEN || env.INTEGRATION_API_TOKEN.length < 32)
    return false;
  const header = request.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ") || header.length > 300) return false;
  const [a, b] = await Promise.all([
    fingerprint(header.slice(7)),
    fingerprint(env.INTEGRATION_API_TOKEN),
  ]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function processRuleTasks(
  env,
  { now = new Date(), sender, makeMeta } = {},
) {
  await generateTasks(env, { now });
  await env.DB.prepare("INSERT OR REPLACE INTO worker_health VALUES(1,?,?)")
    .bind(Math.floor(now.getTime() / 1000), "rules_ready")
    .run();
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return 0;
  const rows = await env.DB.prepare(
    "SELECT * FROM message_tasks WHERE state IN ('pending','rate_limited') AND json_extract(body,'$.delivery')='meta' ORDER BY created,id LIMIT 3",
  ).all();
  let processed = 0;
  for (const row of rows.results) {
    if (
      JSON.parse(row.body).delivery !== "meta" ||
      (row.state === "rate_limited" &&
        Math.floor(now.getTime() / 1000) - row.updated < 900)
    )
      continue;
    const valid = await validTask(env, row, now);
    if (!valid) continue;
    const claim = await env.DB.prepare(
      "UPDATE message_tasks SET state='processing',updated=? WHERE id=? AND signature=? AND state IN ('pending','rate_limited') AND (SELECT revision FROM workspace WHERE id=1)=? RETURNING id",
    )
      .bind(
        Math.floor(now.getTime() / 1000),
        row.id,
        row.signature,
        valid.revision,
      )
      .first();
    if (!claim) continue;
    const client = valid.state.clients.find(
      (c) => c.id === valid.task.clientId,
    );
    let result;
    try {
      result = await sender(
        makeMeta(client, valid.task.meta, valid.state.settings),
        env,
      );
    } catch {
      result = { state: "uncertain", error: "unknown" };
    }
    await env.DB.prepare(
      "UPDATE message_tasks SET state=?,updated=?,provider_id=?,error=? WHERE id=?",
    )
      .bind(
        result.state,
        Math.floor(now.getTime() / 1000),
        result.provider_id || null,
        result.error || null,
        row.id,
      )
      .run();
    if (++processed >= 3) break;
  }
  return processed;
}
export async function ownerTaskStatus(env) {
  const { state: workspaceState } = await read(env.DB),
    confirmed = new Set((workspaceState.taskReceipts || []).map((r) => r.id));
  const rows = await env.DB.prepare(
    "SELECT id,signature,body,state,updated,provider_id,error FROM message_tasks ORDER BY updated DESC LIMIT 200",
  ).all();
  return {
    supported: true,
    configured: Boolean(
      env.INTEGRATION_API_TOKEN && env.INTEGRATION_API_TOKEN.length >= 32,
    ),
    tasks: rows.results.map((r) => ({
      id: r.id,
      signature: r.signature,
      state: confirmed.has(r.id) ? "completed" : r.state,
      updated: r.updated,
      providerId: r.provider_id,
      error: r.error,
      task: JSON.parse(r.body),
    })),
  };
}
