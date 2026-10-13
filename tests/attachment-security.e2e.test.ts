import { afterAll, beforeAll, describe, expect, test } from "bun:test";

// Run only against an isolated seeded API and database (see docs/ARCHITECTURE.md).
const API = process.env.API_URL ?? "http://localhost:3000/api/v1";
let pm = "";
let internal = "";
let unrelated = "";
let client = "";
let projectId = "";
let firstTaskId = "";
let secondTaskId = "";
let attachmentId = "";

async function call(
	method: string,
	path: string,
	token?: string,
	body?: unknown,
) {
	const response = await fetch(`${API}${path}`, {
		method,
		headers: {
			"Content-Type": "application/json",
			...(token ? { Authorization: `Bearer ${token}` } : {}),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	return { status: response.status, body: await response.json() };
}

async function login(email: string) {
	const response = await call("POST", "/auth/login", undefined, {
		email,
		password: "Password123!",
	});
	expect(response.status).toBe(200);
	return response.body.data;
}

beforeAll(async () => {
	const manager = await login("pm@assessment.test");
	const engineer = await login("frontend@assessment.test");
	const outsider = await login("uiux@assessment.test");
	expect(outsider.user.departmentId).not.toBe(engineer.user.departmentId);
	const customer = await login("client@assessment.test");
	pm = manager.accessToken;
	internal = engineer.accessToken;
	unrelated = outsider.accessToken;
	client = customer.accessToken;
	const project = await call("POST", "/projects", pm, {
		name: `Attachment security ${Date.now()}`,
		clientId: customer.user.id,
	});
	expect(project.status).toBe(201);
	projectId = project.body.data.id;
	expect(
		(
			await call("POST", `/projects/${projectId}/departments`, pm, {
				departmentId: engineer.user.departmentId,
			})
		).status,
	).toBe(201);
	for (const visible of [false, true]) {
		const task = await call("POST", "/tasks", pm, {
			projectId,
			title: `Attachment fixture ${visible}`,
			departmentId: engineer.user.departmentId,
			assigneeId: engineer.user.id,
			clientVisible: visible,
		});
		expect(task.status).toBe(201);
		if (visible) secondTaskId = task.body.data.id;
		else firstTaskId = task.body.data.id;
	}
	const attachment = await call(
		"POST",
		`/tasks/${firstTaskId}/attachments`,
		internal,
		{
			fileName: "Example link",
			fileUrl: "https://example.test/file",
			mimeType: "text/uri-list",
		},
	);
	expect(attachment.status).toBe(201);
	attachmentId = attachment.body.data.id;
}, 15_000);

describe("Attachment authorization and client isolation", () => {
	test("rejects unauthenticated attachment requests", async () => {
		expect(
			(await call("GET", `/tasks/${firstTaskId}/attachments`)).status,
		).toBe(401);
	});
	test("allows the assigned internal team to list attachments", async () => {
		const response = await call(
			"GET",
			`/tasks/${firstTaskId}/attachments`,
			internal,
		);
		expect(response.status).toBe(200);
		expect(
			response.body.data.some(
				(item: { id: string }) => item.id === attachmentId,
			),
		).toBe(true);
	});
	test("blocks CLIENT from internal attachment endpoints", async () => {
		expect(
			(await call("GET", `/tasks/${firstTaskId}/attachments`, client)).status,
		).toBe(403);
	});
	test("blocks an unrelated department from reading or deleting attachments", async () => {
		expect(
			(await call("GET", `/tasks/${firstTaskId}/attachments`, unrelated))
				.status,
		).toBe(403);
		expect(
			(
				await call(
					"DELETE",
					`/tasks/${firstTaskId}/attachments/${attachmentId}`,
					unrelated,
				)
			).status,
		).toBe(403);
	});
	test("cannot delete an attachment through a different task ID, even as PM", async () => {
		expect(
			(
				await call(
					"DELETE",
					`/tasks/${secondTaskId}/attachments/${attachmentId}`,
					pm,
				)
			).status,
		).toBe(404);
		const response = await call("GET", `/tasks/${firstTaskId}/attachments`, pm);
		expect(
			response.body.data.some(
				(item: { id: string }) => item.id === attachmentId,
			),
		).toBe(true);
	});
	test("client sees only visible tasks with public DTO fields", async () => {
		const response = await call(
			"GET",
			`/client/projects/${projectId}/tasks`,
			client,
		);
		expect(response.status).toBe(200);
		expect(response.body.data.map((item: { id: string }) => item.id)).toEqual([
			secondTaskId,
		]);
		expect(Object.keys(response.body.data[0]).sort()).toEqual(
			["id", "title", "status", "createdAt", "updatedAt"].sort(),
		);
	});
	test("physical file retrieval rejects encoded Windows path traversal", async () => {
		const response = await call(
			"GET",
			`/uploads/${encodeURIComponent("..\\..\\.env")}`,
			pm,
		);
		expect(response.status).toBe(404);
	});
	test("the uploader can still delete the attachment through its own task", async () => {
		expect(
			(
				await call(
					"DELETE",
					`/tasks/${firstTaskId}/attachments/${attachmentId}`,
					internal,
				)
			).status,
		).toBe(200);
		const response = await call(
			"GET",
			`/tasks/${firstTaskId}/attachments`,
			internal,
		);
		expect(response.body.data).toEqual([]);
	});
	test("PM can archive and restore a task without losing client visibility", async () => {
		expect((await call("DELETE", `/tasks/${secondTaskId}`, pm)).status).toBe(
			200,
		);
		expect((await call("GET", `/tasks/${secondTaskId}`, pm)).status).toBe(404);
		expect(
			(await call("POST", `/trash/tasks/${secondTaskId}/restore`, pm)).status,
		).toBe(200);
		const response = await call(
			"GET",
			`/client/projects/${projectId}/tasks`,
			client,
		);
		expect(response.body.data.map((item: { id: string }) => item.id)).toEqual([
			secondTaskId,
		]);
	});
});

afterAll(async () => {
	for (const id of [firstTaskId, secondTaskId])
		if (id) await call("DELETE", `/tasks/${id}`, pm);
	if (projectId) await call("DELETE", `/projects/${projectId}`, pm);
});
