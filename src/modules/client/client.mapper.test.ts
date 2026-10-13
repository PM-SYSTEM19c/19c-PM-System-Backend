import { describe, expect, test } from "bun:test";
import {
	toClientProject,
	toClientTask,
	toClientTaskList,
} from "./client.mapper";

const task = {
	id: "task-example",
	title: "Approved deliverable",
	status: "DONE" as const,
	clientVisible: true,
	createdAt: new Date("2026-01-01"),
	updatedAt: new Date("2026-01-02"),
	assigneeId: "internal-user",
	departmentId: "private-department",
	version: 4,
	assignee: { name: "Internal identity", email: "private@example.test" },
	auditLogs: [{ newValue: "Internal note" }],
};

describe("Client DTO allowlist", () => {
	test("never exposes internal task fields even if new fields are added to the entity", () => {
		expect(toClientTask(task)).toEqual({
			id: task.id,
			title: task.title,
			status: task.status,
			createdAt: task.createdAt,
			updatedAt: task.updatedAt,
		});
	});
	test("removes hidden tasks before mapping", () => {
		expect(
			toClientTaskList([
				task,
				{ ...task, id: "hidden-task", clientVisible: false },
			]),
		).toEqual([toClientTask(task)]);
	});
	test("returns only the existing public project fields", () => {
		const project = {
			id: "project-example",
			name: "Example project",
			description: null,
			clientId: "client-id",
			departments: [{ name: "Private department" }],
		};
		expect(toClientProject(project, 50)).toEqual({
			id: project.id,
			name: project.name,
			description: null,
			progress: 50,
		});
	});
});
