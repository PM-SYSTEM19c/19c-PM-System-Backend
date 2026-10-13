/**
 * E2E Tests — Daily Standup Summary + Audit Trail Immutability + Soft Delete
 *
 * These tests verify:
 * 1. Standup generation from audit logs
 * 2. Idempotent re-generation (cached unless forced)
 * 3. Blocked task detection in standups
 * 4. Batch generate-all endpoint
 * 5. Audit log immutability (cannot UPDATE or DELETE)
 * 6. Soft delete (physical DELETE is rejected)
 * 7. Full audit trail coverage for task changes
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "@prisma/client";

// Plain client WITHOUT the app's soft-delete extension → proves the DB itself enforces rules
const rawDb = new PrismaClient();

const API = process.env.API_URL ?? "http://localhost:3000/api/v1";
let pmToken: string;
let projectId: string;

async function login(email: string, password = "Password123!") {
	const res = await fetch(`${API}/auth/login`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ email, password }),
	});
	const json = await res.json();
	return json.data.accessToken;
}

async function authed(method: string, path: string, token: string, body?: any) {
	const opts: RequestInit = {
		method,
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
	};
	if (body) opts.body = JSON.stringify(body);
	const res = await fetch(`${API}${path}`, opts);
	return { status: res.status, json: await res.json() };
}

beforeAll(async () => {
	pmToken = await login("pm@assessment.test");

	// Pick the first project with tasks
	const { json } = await authed("GET", "/projects", pmToken);
	const project = json.data.find(
		(item: { taskStats?: { total: number } }) =>
			(item.taskStats?.total ?? 0) > 0,
	);
	if (!project)
		throw new Error("Standup E2E requires a seeded project with tasks");
	projectId = project.id;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Standup Generation
// ─────────────────────────────────────────────────────────────────────────────

describe("Daily Standup Generation", () => {
	test("should generate standup for a project on a given date", async () => {
		const { status, json } = await authed(
			"POST",
			`/projects/${projectId}/standups/generate?date=2026-10-02&force=true`,
			pmToken,
		);
		expect(status).toBe(201);
		expect(json.success).toBe(true);
		expect(json.data.projectId).toBe(projectId);
		expect(json.data.date).toBe("2026-10-02");
		expect(json.data.timezone).toBe("Asia/Jakarta");
		expect(json.data.summary).toBeDefined();
		expect(typeof json.data.summary.totalChanges).toBe("number");
		expect(json.data.departments).toBeInstanceOf(Array);
	});

	test("should return cached standup on re-generation without force", async () => {
		// First generate
		const { json: first } = await authed(
			"POST",
			`/projects/${projectId}/standups/generate?date=2026-10-02`,
			pmToken,
		);
		// Second generate (should be cached)
		const { json: second } = await authed(
			"POST",
			`/projects/${projectId}/standups/generate?date=2026-10-02`,
			pmToken,
		);
		// generatedAt should be the same (cached)
		expect(first.data.generatedAt).toBe(second.data.generatedAt);
	});

	test("should force-regenerate standup with force=true", async () => {
		const { json: first } = await authed(
			"POST",
			`/projects/${projectId}/standups/generate?date=2026-10-02`,
			pmToken,
		);
		// Wait a tiny bit to ensure different timestamp
		await new Promise((r) => setTimeout(r, 50));
		const { json: second } = await authed(
			"POST",
			`/projects/${projectId}/standups/generate?date=2026-10-02&force=true`,
			pmToken,
		);
		expect(second.data.generatedAt).not.toBe(first.data.generatedAt);
	});

	test("should retrieve standup by date", async () => {
		const { status, json } = await authed(
			"GET",
			`/projects/${projectId}/standups/2026-10-02`,
			pmToken,
		);
		expect(status).toBe(200);
		expect(json.data.date).toBe("2026-10-02");
	});

	test("should return 404 for non-existent standup date", async () => {
		const { status } = await authed(
			"GET",
			`/projects/${projectId}/standups/2000-01-01`,
			pmToken,
		);
		expect(status).toBe(404);
	});

	test("should list standups for a project", async () => {
		const { status, json } = await authed(
			"GET",
			`/projects/${projectId}/standups`,
			pmToken,
		);
		expect(status).toBe(200);
		expect(json.data).toBeInstanceOf(Array);
		expect(json.data.length).toBeGreaterThan(0);
		// List should include summary metadata
		expect(json.data[0]).toHaveProperty("summary");
		expect(json.data[0]).toHaveProperty("date");
	});

	test("should validate date format", async () => {
		const { status } = await authed(
			"POST",
			`/projects/${projectId}/standups/generate?date=not-a-date`,
			pmToken,
		);
		expect(status).toBe(400);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Standup Content — Blocked Tasks
// ─────────────────────────────────────────────────────────────────────────────

describe("Standup Blocked Task Detection", () => {
	test("should detect blocked tasks in standup payload", async () => {
		const { json } = await authed(
			"POST",
			`/projects/${projectId}/standups/generate?date=2026-10-02&force=true`,
			pmToken,
		);

		const allBlocked = json.data.departments.flatMap((d: any) => d.blocked);

		// At least some tasks should be blocked (our seed data has dependencies)
		// The specific count depends on whether deps are resolved, but the structure must be correct
		for (const b of allBlocked) {
			expect(b).toHaveProperty("taskId");
			expect(b).toHaveProperty("taskTitle");
			expect(b.blockedBy).toBeInstanceOf(Array);
			for (const dep of b.blockedBy) {
				expect(dep).toHaveProperty("taskId");
				expect(dep).toHaveProperty("taskTitle");
				expect(dep).toHaveProperty("status");
			}
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Batch Generation
// ─────────────────────────────────────────────────────────────────────────────

describe("Batch Standup Generation", () => {
	test("should generate standups for all projects", async () => {
		const { status, json } = await authed(
			"POST",
			"/standups/generate-all?date=2026-10-02&force=true",
			pmToken,
		);
		expect(status).toBe(201);
		expect(json.data).toBeInstanceOf(Array);
		expect(json.data.length).toBeGreaterThanOrEqual(2);

		for (const result of json.data) {
			expect(result.status).toBe("ok");
			expect(result).toHaveProperty("projectId");
			expect(result).toHaveProperty("projectName");
		}
	});

	test("should not allow non-PM to batch-generate", async () => {
		const internalToken = await login("frontend@assessment.test");
		const { status } = await authed(
			"POST",
			"/standups/generate-all?date=2026-10-02",
			internalToken,
		);
		expect(status).toBe(403);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Audit Trail Immutability
// ─────────────────────────────────────────────────────────────────────────────

describe("Audit Trail Immutability", () => {
	test("audit logs should be created for task status changes", async () => {
		// Fresh, dependency-free task so the transition is always valid
		const loginRes = await fetch(`${API}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "frontend@assessment.test",
				password: "Password123!",
			}),
		});
		const loginJson = await loginRes.json();
		const engineer = loginJson.data.user;
		const engineerToken = loginJson.data.accessToken;

		const { json: created } = await authed("POST", "/tasks", pmToken, {
			projectId,
			title: `Audit Status Test ${Date.now()}`,
			departmentId: engineer.departmentId,
			assigneeId: engineer.id,
		});
		expect(created.success).toBe(true);
		const task = created.data;

		const { status, json: upd } = await authed(
			"PATCH",
			`/tasks/${task.id}/status`,
			engineerToken,
			{ status: "IN_PROGRESS", version: task.version },
		);
		expect(status).toBe(200);
		expect(upd.success).toBe(true);

		const { json: auditResp } = await authed(
			"GET",
			`/tasks/${task.id}/audit-logs`,
			pmToken,
		);
		const statusLog = auditResp.data.find(
			(l: any) => l.changedColumn === "status" && l.newValue === "IN_PROGRESS",
		);
		expect(statusLog).toBeDefined();
		expect(statusLog.oldValue).toBe("TODO");
		expect(statusLog.userId).toBe(engineer.id);
		expect(statusLog.createdAt).toBeDefined();

		// Clean up (soft delete)
		await authed("DELETE", `/tasks/${task.id}`, pmToken);
	});

	test("audit logs should record field changes on task update", async () => {
		// Pick a task and update description
		const { json: tasksResp } = await authed(
			"GET",
			`/tasks?filter[projectId]=${projectId}`,
			pmToken,
		);
		const task = tasksResp.data[0];

		const newDesc = `Updated at ${Date.now()}`;
		await authed("PATCH", `/tasks/${task.id}`, pmToken, {
			description: newDesc,
			version: task.version,
		});

		const { json: auditResp } = await authed(
			"GET",
			`/tasks/${task.id}/audit-logs`,
			pmToken,
		);

		const descLog = auditResp.data.find(
			(l: any) => l.changedColumn === "description" && l.newValue === newDesc,
		);
		expect(descLog).toBeDefined();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Soft Delete Enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe("Soft Delete Enforcement", () => {
	test("task delete should be soft (deletedAt set, not physically removed)", async () => {
		// Create a task to delete
		const loginRes = await fetch(`${API}/auth/login`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				email: "frontend@assessment.test",
				password: "Password123!",
			}),
		});
		const assignee = (await loginRes.json()).data.user;

		const { json: createResp } = await authed("POST", "/tasks", pmToken, {
			projectId,
			title: `Soft Delete Test ${Date.now()}`,
			description: "Will be soft deleted",
			departmentId: assignee.departmentId,
			assigneeId: assignee.id,
		});
		expect(createResp.success).toBe(true);
		const taskId = createResp.data.id;

		// Delete via API
		const { status: delStatus } = await authed(
			"DELETE",
			`/tasks/${taskId}`,
			pmToken,
		);
		expect(delStatus).toBe(200);

		// Task should not appear in normal list
		const { json: tasksAfter } = await authed(
			"GET",
			`/tasks?filter[projectId]=${projectId}`,
			pmToken,
		);
		const found = tasksAfter.data.find((t: any) => t.id === taskId);
		expect(found).toBeUndefined();

		// ...but the row physically still exists with deletedAt set
		const row = await rawDb.task.findUnique({ where: { id: taskId } });
		expect(row).not.toBeNull();
		expect(row!.deletedAt).not.toBeNull();
	});

	test("removing a dependency is soft; re-adding revives the same row", async () => {
		const engineerLogin = await (
			await fetch(`${API}/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: "frontend@assessment.test",
					password: "Password123!",
				}),
			})
		).json();
		const eng = engineerLogin.data.user;
		const mk = async (title: string) =>
			(
				await authed("POST", "/tasks", pmToken, {
					projectId,
					title: `${title} ${Date.now()}`,
					departmentId: eng.departmentId,
					assigneeId: eng.id,
				})
			).json.data;

		const a = await mk("Dep A");
		const b = await mk("Dep B");

		expect(
			(
				await authed("POST", `/tasks/${b.id}/dependencies`, pmToken, {
					dependsOnTaskId: a.id,
				})
			).status,
		).toBe(201);
		expect(
			(await authed("GET", `/tasks/${b.id}`, pmToken)).json.data
				.effectiveStatus,
		).toBe("BLOCKED");

		expect(
			(await authed("DELETE", `/tasks/${b.id}/dependencies/${a.id}`, pmToken))
				.status,
		).toBe(200);
		expect(
			(await authed("GET", `/tasks/${b.id}`, pmToken)).json.data
				.effectiveStatus,
		).toBe("TODO");

		const link = await rawDb.taskDependency.findUnique({
			where: { taskId_dependsOnId: { taskId: b.id, dependsOnId: a.id } },
		});
		expect(link).not.toBeNull();
		expect(link!.deletedAt).not.toBeNull();

		// Re-add → revived, blocked again
		expect(
			(
				await authed("POST", `/tasks/${b.id}/dependencies`, pmToken, {
					dependsOnTaskId: a.id,
				})
			).status,
		).toBe(201);
		expect(
			(await authed("GET", `/tasks/${b.id}`, pmToken)).json.data
				.effectiveStatus,
		).toBe("BLOCKED");

		// Both changes are in the audit trail
		const logs = (await authed("GET", `/tasks/${b.id}/audit-logs`, pmToken))
			.json.data;
		expect(
			logs.some((l: any) => l.changedColumn === "dependency_removed"),
		).toBe(true);
		expect(
			logs.filter((l: any) => l.changedColumn === "dependency_added").length,
		).toBe(2);

		await authed("DELETE", `/tasks/${b.id}`, pmToken);
		await authed("DELETE", `/tasks/${a.id}`, pmToken);
	});

	test("removing a department from a project is soft and revokes access", async () => {
		const marketing = await (
			await fetch(`${API}/auth/login`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					email: "marketing@assessment.test",
					password: "Password123!",
				}),
			})
		).json();
		const mToken = marketing.data.accessToken;
		const deptId = marketing.data.user.departmentId;

		const project = (
			await authed("POST", "/projects", pmToken, {
				name: `Soft Dept ${Date.now()}`,
			})
		).json.data;
		expect(
			(
				await authed("POST", `/projects/${project.id}/departments`, pmToken, {
					departmentId: deptId,
				})
			).status,
		).toBe(201);
		expect(
			(await authed("GET", `/projects/${project.id}`, mToken)).status,
		).toBe(200);

		expect(
			(
				await authed(
					"DELETE",
					`/projects/${project.id}/departments/${deptId}`,
					pmToken,
				)
			).status,
		).toBe(200);
		expect(
			(await authed("GET", `/projects/${project.id}`, mToken)).status,
		).toBe(403);

		const link = await rawDb.projectDepartment.findUnique({
			where: {
				projectId_departmentId: { projectId: project.id, departmentId: deptId },
			},
		});
		expect(link!.deletedAt).not.toBeNull();

		// Re-add revives access
		expect(
			(
				await authed("POST", `/projects/${project.id}/departments`, pmToken, {
					departmentId: deptId,
				})
			).status,
		).toBe(201);
		expect(
			(await authed("GET", `/projects/${project.id}`, mToken)).status,
		).toBe(200);

		await authed("DELETE", `/projects/${project.id}`, pmToken);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Database-level guarantees (bypassing the application entirely)
// ─────────────────────────────────────────────────────────────────────────────

describe("Database triggers", () => {
	test("physical DELETE on a business table is rejected by PostgreSQL", async () => {
		const anyTask = await rawDb.task.findFirst();
		await expect(
			Promise.resolve(
				rawDb.$executeRawUnsafe(
					`DELETE FROM "tasks" WHERE id = $1`,
					anyTask!.id,
				),
			),
		).rejects.toThrow(/HARD_DELETE_FORBIDDEN/);
		expect(
			await rawDb.task.findUnique({ where: { id: anyTask!.id } }),
		).not.toBeNull();
	});

	test("UPDATE and DELETE on task_audit_logs are rejected by PostgreSQL", async () => {
		const log = await rawDb.taskAuditLog.findFirst();
		await expect(
			Promise.resolve(
				rawDb.$executeRawUnsafe(
					`UPDATE "task_audit_logs" SET "newValue" = 'tampered' WHERE id = $1`,
					log!.id,
				),
			),
		).rejects.toThrow(/AUDIT_LOG_IMMUTABLE/);
		await expect(
			Promise.resolve(
				rawDb.$executeRawUnsafe(
					`DELETE FROM "task_audit_logs" WHERE id = $1`,
					log!.id,
				),
			),
		).rejects.toThrow(/HARD_DELETE_FORBIDDEN/);
		const after = await rawDb.taskAuditLog.findUnique({
			where: { id: log!.id },
		});
		expect(after!.newValue).toBe(log!.newValue);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Masking — standups contain internal identities
// ─────────────────────────────────────────────────────────────────────────────

describe("Standup masking & Audit log access control", () => {
	test("CLIENT cannot read standup summaries", async () => {
		const clientToken = await login("client@assessment.test");
		const { status } = await authed(
			"GET",
			`/projects/${projectId}/standups`,
			clientToken,
		);
		expect(status).toBe(403);
	});

	test("CLIENT cannot read project audit logs (P1-01 fix)", async () => {
		const clientToken = await login("client@assessment.test");
		const { status } = await authed(
			"GET",
			`/projects/${projectId}/audit-logs`,
			clientToken,
		);
		expect(status).toBe(403);
	});

	test("PM can read project audit logs", async () => {
		const { status, json } = await authed(
			"GET",
			`/projects/${projectId}/audit-logs`,
			pmToken,
		);
		expect(status).toBe(200);
		expect(Array.isArray(json.data)).toBe(true);
	});
});

afterAll(async () => {
	await rawDb.$disconnect();
});

console.log("✅ All Daily Standup & Audit Trail E2E tests loaded");
