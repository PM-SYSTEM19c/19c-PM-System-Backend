import { describe, expect, it } from "bun:test";
import type { TaskStatus } from "@prisma/client";
import { ERROR_CODES } from "../../config/constants";
import { AppError, ForbiddenError } from "../../shared/errors";
import type { AuthUser } from "../../shared/types";
import { assertCanUpdateStatus, canViewTask } from "./task.permission";

describe("Task Permission Engine", () => {
	const pmUser: AuthUser = { id: "pm1", role: "PM", departmentId: null };
	const internalUser1: AuthUser = {
		id: "u1",
		role: "INTERNAL",
		departmentId: "dept1",
	};
	const internalUser2: AuthUser = {
		id: "u2",
		role: "INTERNAL",
		departmentId: "dept2",
	};
	const clientUser: AuthUser = { id: "c1", role: "CLIENT", departmentId: null };

	const baseTask = {
		id: "t1",
		projectId: "p1",
		departmentId: "dept1",
		assigneeId: "u1",
	};

	describe("canViewTask", () => {
		it("should allow PM to view any task", () => {
			expect(canViewTask(pmUser, { ...baseTask, status: "TODO" })).toBe(true);
		});

		it("should deny CLIENT access", () => {
			expect(canViewTask(clientUser, { ...baseTask, status: "TODO" })).toBe(
				false,
			);
		});

		it("should allow INTERNAL user from same department", () => {
			expect(canViewTask(internalUser1, { ...baseTask, status: "TODO" })).toBe(
				true,
			);
		});

		it("should deny INTERNAL user from different department if not assignee", () => {
			expect(canViewTask(internalUser2, { ...baseTask, status: "TODO" })).toBe(
				false,
			);
		});

		it("should allow INTERNAL user from different department if they are the assignee", () => {
			expect(
				canViewTask(internalUser2, {
					...baseTask,
					status: "TODO",
					assigneeId: "u2",
				}),
			).toBe(true);
		});
	});

	describe("assertCanUpdateStatus", () => {
		const task = { ...baseTask, status: "TODO" as TaskStatus };

		it("should throw ForbiddenError for CLIENT", () => {
			expect(() =>
				assertCanUpdateStatus(clientUser, task, "IN_PROGRESS", true, 0),
			).toThrow(ForbiddenError);
		});

		it("should throw AppError for INTERNAL user in wrong department", () => {
			expect(() =>
				assertCanUpdateStatus(internalUser2, task, "IN_PROGRESS", true, 0),
			).toThrowError(
				new AppError(
					ERROR_CODES.DEPARTMENT_MISMATCH,
					403,
					"You can only update tasks in your own department",
				),
			);
		});

		it("should throw AppError for INTERNAL user who is not assignee", () => {
			const unassignedTask = { ...task, assigneeId: "some-other-user" };
			expect(() =>
				assertCanUpdateStatus(
					internalUser1,
					unassignedTask,
					"IN_PROGRESS",
					true,
					0,
				),
			).toThrowError(
				new AppError(
					ERROR_CODES.NOT_ASSIGNEE,
					403,
					"You can only update tasks assigned to you",
				),
			);
		});

		it("should prevent TODO to DONE transition", () => {
			expect(() =>
				assertCanUpdateStatus(
					pmUser,
					{ ...task, status: "TODO" },
					"DONE",
					true,
					0,
				),
			).toThrowError(
				new AppError(
					ERROR_CODES.INVALID_STATUS_TRANSITION,
					400,
					"Cannot move task directly from TODO to DONE. Task must go through IN_PROGRESS first.",
				),
			);
		});

		it("should allow executor to complete task (IN_PROGRESS to DONE)", () => {
			expect(() =>
				assertCanUpdateStatus(
					internalUser1,
					{ ...task, status: "IN_PROGRESS" },
					"DONE",
					true,
					0,
				),
			).not.toThrow();
		});

		it("should prevent PM from completing task if not executor", () => {
			expect(() =>
				assertCanUpdateStatus(
					pmUser,
					{ ...task, status: "IN_PROGRESS" },
					"DONE",
					true,
					0,
				),
			).toThrowError(
				new AppError(
					ERROR_CODES.EXECUTOR_ONLY,
					403,
					"Only the assigned executor can complete a task",
				),
			);
		});

		it("should prevent starting task if dependencies not done", () => {
			expect(() =>
				assertCanUpdateStatus(
					internalUser1,
					{ ...task, status: "TODO" },
					"IN_PROGRESS",
					false,
					1,
				),
			).toThrowError(
				new AppError(
					ERROR_CODES.TASK_BLOCKED,
					409,
					"Task cannot be started because 1 dependency is incomplete.",
				),
			);
		});

		it("should allow starting task if dependencies done", () => {
			expect(() =>
				assertCanUpdateStatus(
					internalUser1,
					{ ...task, status: "TODO" },
					"IN_PROGRESS",
					true,
					0,
				),
			).not.toThrow();
		});

		it("should allow executor to reopen completed task", () => {
			expect(() =>
				assertCanUpdateStatus(
					internalUser1,
					{ ...task, status: "DONE" },
					"IN_PROGRESS",
					true,
					0,
				),
			).not.toThrow();
		});

		it("should allow PM to reopen completed task", () => {
			expect(() =>
				assertCanUpdateStatus(
					pmUser,
					{ ...task, status: "DONE" },
					"IN_PROGRESS",
					true,
					0,
				),
			).not.toThrow();
		});

		it("should prevent non-executor INTERNAL from reopening task", () => {
			const notMyTask = { ...task, assigneeId: "other" };
			expect(() =>
				assertCanUpdateStatus(
					internalUser1,
					{ ...notMyTask, status: "DONE" },
					"IN_PROGRESS",
					true,
					0,
				),
			).toThrow(AppError);
		});
	});
});
