/**
 * E2E: Dependency-aware task board + concurrency / optimistic locking.
 *
 * Runs against a live API (default http://localhost:3000/api/v1) with seeded users:
 *   bun test tests/
 *   API_URL=http://host:port/api/v1 bun test tests/
 *
 * Scenario from the PRD:
 *   Task A (UI design, UI/UX) + Task B (API integration, Backend) are prerequisites of
 *   Task C (Frontend slicing). C must be BLOCKED until A and B are DONE, enforced in the API.
 *   A PM editing C's description while the engineer marks C DONE must never overwrite each other.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const API = process.env.API_URL ?? "http://localhost:3000/api/v1";
const PASSWORD = "Password123!";

type Json = Record<string, any>;
interface Res {
  status: number;
  body: Json;
}

async function call(token: string | null, method: string, path: string, body?: unknown): Promise<Res> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function login(email: string) {
  const r = await call(null, "POST", "/auth/login", { email, password: PASSWORD });
  if (r.status !== 200) throw new Error(`login ${email} failed: ${JSON.stringify(r.body)}`);
  return r.body.data.accessToken as string;
}

const tokens: Record<"pm" | "uiux" | "backend" | "frontend", string> = {} as any;
const ids: Record<string, string> = {};
const created: string[] = [];

const getTask = async (id: string) => (await call(tokens.pm, "GET", `/tasks/${id}`)).body.data;
const setStatus = (who: keyof typeof tokens, id: string, status: string, version: number, extra: Json = {}) =>
  call(tokens[who], "PATCH", `/tasks/${id}/status`, { status, version, ...extra });

async function createTask(title: string, assigneeKey: "uiux" | "backend" | "frontend") {
  const r = await call(tokens.pm, "POST", "/tasks", {
    projectId: ids.project,
    title: `[e2e] ${title} ${Date.now()}`,
    description: "original description",
    departmentId: ids[`dept_of_${assigneeKey}`],
    assigneeId: ids[assigneeKey],
    clientVisible: false,
  });
  expect(r.status).toBe(201);
  created.push(r.body.data.id);
  return r.body.data.id as string;
}

beforeAll(async () => {
  tokens.pm = await login("pm@assessment.test");
  tokens.uiux = await login("uiux@assessment.test");
  tokens.backend = await login("backend@assessment.test");
  tokens.frontend = await login("frontend@assessment.test");

  const projects = await call(tokens.pm, "GET", "/projects?pageSize=1");
  ids.project = projects.body.data[0].id;

  const users = await call(tokens.pm, "GET", "/users?filter[role]=INTERNAL&pageSize=100");
  for (const u of users.body.data) {
    const key = String(u.email).split("@")[0];
    ids[key] = u.id;
    if (u.departmentId) ids[`dept_of_${key}`] = u.departmentId;
  }

  for (const k of ["project", "uiux", "frontend", "dept_of_uiux", "dept_of_backend", "dept_of_frontend"]) {
    if (!ids[k]) throw new Error(`Missing seed data: ${k}`);
  }
});

afterAll(async () => {
  for (const id of created.reverse()) await call(tokens.pm, "DELETE", `/tasks/${id}`);
});

describe("Dependency-aware task board", () => {
  let A: string;
  let B: string;
  let C: string;

  test("setup: C depends on A and B", async () => {
    A = await createTask("A - UI Design", "uiux");
    B = await createTask("B - Backend API", "backend");
    C = await createTask("C - Frontend Slicing", "frontend");
    expect((await call(tokens.pm, "POST", `/tasks/${C}/dependencies`, { dependsOnTaskId: A })).status).toBe(201);
    expect((await call(tokens.pm, "POST", `/tasks/${C}/dependencies`, { dependsOnTaskId: B })).status).toBe(201);
  });

  test("C is automatically BLOCKED and lists both blockers", async () => {
    const c = await getTask(C);
    expect(c.effectiveStatus).toBe("BLOCKED");
    expect(c.blockedBy.map((t: Json) => t.id).sort()).toEqual([A, B].sort());

    // Board/list endpoint exposes the same computed state
    const list = await call(tokens.pm, "GET", `/tasks?filter[projectId]=${ids.project}&pageSize=100`);
    const row = list.body.data.find((t: Json) => t.id === C);
    expect(row.effectiveStatus).toBe("BLOCKED");
    expect(row.blockedBy).toHaveLength(2);
  });

  test("Frontend engineer cannot start C via the API (409 TASK_BLOCKED)", async () => {
    const c = await getTask(C);
    const r = await setStatus("frontend", C, "IN_PROGRESS", c.version);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("TASK_BLOCKED");
    expect(r.body.error.details.blockedBy).toHaveLength(2);
  });

  test("Still BLOCKED when only A is DONE", async () => {
    let a = await getTask(A);
    expect((await setStatus("uiux", A, "IN_PROGRESS", a.version)).status).toBe(200);
    a = await getTask(A);
    expect((await setStatus("uiux", A, "DONE", a.version)).status).toBe(200);

    const c = await getTask(C);
    expect(c.effectiveStatus).toBe("BLOCKED");
    expect(c.blockedBy.map((t: Json) => t.id)).toEqual([B]);
    const r = await setStatus("frontend", C, "IN_PROGRESS", c.version);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("TASK_BLOCKED");
  });

  test("Unblocked once A and B are DONE; frontend can start C", async () => {
    let b = await getTask(B);
    expect((await setStatus("backend", B, "IN_PROGRESS", b.version)).status).toBe(200);
    b = await getTask(B);
    expect((await setStatus("backend", B, "DONE", b.version)).status).toBe(200);

    const c = await getTask(C);
    expect(c.effectiveStatus).toBe("TODO");
    const r = await setStatus("frontend", C, "IN_PROGRESS", c.version);
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe("IN_PROGRESS");
  });

  test("Edge: prerequisite A cannot be reopened while C is active (409 DEPENDENTS_ACTIVE)", async () => {
    const a = await getTask(A);
    const r = await setStatus("uiux", A, "IN_PROGRESS", a.version);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("DEPENDENTS_ACTIVE");
  });

  test("Edge: circular dependency A → C is rejected", async () => {
    const r = await call(tokens.pm, "POST", `/tasks/${A}/dependencies`, { dependsOnTaskId: C });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("CIRCULAR_DEPENDENCY");
  });

  test("Edge: unfinished prerequisite cannot be attached to a started task", async () => {
    const D = await createTask("D - late prerequisite", "uiux");
    const r = await call(tokens.pm, "POST", `/tasks/${C}/dependencies`, { dependsOnTaskId: D });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("DEPENDENCY_ON_STARTED_TASK");
  });

  test("Edge: concurrent start vs. reopen race is serialised (never start on a reopened prerequisite)", async () => {
    // Fresh chain: E depends on F (F DONE). Fire "start E" and "reopen F" at the same time.
    const F = await createTask("F - prereq", "uiux");
    const E = await createTask("E - dependent", "frontend");
    expect((await call(tokens.pm, "POST", `/tasks/${E}/dependencies`, { dependsOnTaskId: F })).status).toBe(201);
    let f = await getTask(F);
    await setStatus("uiux", F, "IN_PROGRESS", f.version);
    f = await getTask(F);
    await setStatus("uiux", F, "DONE", f.version);

    f = await getTask(F);
    const e = await getTask(E);
    const [start, reopen] = await Promise.all([
      setStatus("frontend", E, "IN_PROGRESS", e.version),
      setStatus("uiux", F, "IN_PROGRESS", f.version),
    ]);

    // Exactly one may win; the invariant "E in progress ⇒ F done" must hold.
    expect([start.status, reopen.status].filter((s) => s === 200)).toHaveLength(1);
    const [eNow, fNow] = [await getTask(E), await getTask(F)];
    if (eNow.status === "IN_PROGRESS") expect(fNow.status).toBe("DONE");
    else expect(start.body.error.code).toBe("TASK_BLOCKED");
  });
});

describe("Concurrency & optimistic locking", () => {
  let T: string;

  test("setup: task in progress assigned to frontend", async () => {
    T = await createTask("T - race", "frontend");
    const t = await getTask(T);
    expect((await setStatus("frontend", T, "IN_PROGRESS", t.version)).status).toBe(200);
  });

  test("PM edits description while engineer marks DONE at the same moment → both kept (safe merge)", async () => {
    const seen = await getTask(T); // both users loaded the same version
    const [edit, done] = await Promise.all([
      call(tokens.pm, "PATCH", `/tasks/${T}`, {
        description: "PM updated description",
        version: seen.version,
        baseline: { description: seen.description },
      }),
      setStatus("frontend", T, "DONE", seen.version, { expectedStatus: seen.status }),
    ]);
    expect(edit.status).toBe(200);
    expect(done.status).toBe(200);

    const now = await getTask(T);
    expect(now.status).toBe("DONE"); // engineer's change not lost
    expect(now.description).toBe("PM updated description"); // PM's change not lost
    expect(now.version).toBe(seen.version + 2); // two serialised writes
  });

  test("Stale write without baseline is rejected with 409 + server snapshot", async () => {
    const now = await getTask(T);
    const r = await call(tokens.pm, "PATCH", `/tasks/${T}`, {
      description: "stale overwrite",
      version: now.version - 1,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("VERSION_CONFLICT");
    expect(r.body.error.details.currentVersion).toBe(now.version);
    expect(r.body.error.details.current.description).toBe("PM updated description");
  });

  test("Two users editing the SAME field concurrently → one wins, the other gets 409 conflictingFields", async () => {
    const seen = await getTask(T);
    const [r1, r2] = await Promise.all(
      ["Edit from tab 1", "Edit from tab 2"].map((description) =>
        call(tokens.pm, "PATCH", `/tasks/${T}`, {
          description,
          version: seen.version,
          baseline: { description: seen.description },
        })
      )
    );
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = r1.status === 409 ? r1 : r2;
    expect(loser.body.error.details.conflictingFields).toEqual(["description"]);
  });

  test("Stale status change whose base status changed is rejected (409)", async () => {
    const now = await getTask(T); // DONE
    const r = await setStatus("frontend", T, "TODO", now.version - 1, { expectedStatus: "IN_PROGRESS" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("VERSION_CONFLICT");
    expect(r.body.error.details.conflictingFields).toEqual(["status"]);
  });

  test("Audit trail records every serialised write", async () => {
    const logs = (await call(tokens.pm, "GET", `/tasks/${T}/audit-logs`)).body.data as Json[];
    const cols = logs.map((l) => l.changedColumn);
    expect(cols.filter((c) => c === "status").length).toBeGreaterThanOrEqual(2);
    expect(cols).toContain("description");
  });
});
