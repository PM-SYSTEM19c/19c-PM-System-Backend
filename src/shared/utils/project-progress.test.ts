import { describe, expect, test } from "bun:test";
import { projectProgress } from "./project-progress";

describe("Project progress contract", () => {
	test("empty projects have zero progress", () => {
		expect(projectProgress([])).toEqual({
			progress: 0,
			taskStats: { total: 0, done: 0 },
		});
	});
	test("only DONE tasks count and percentages retain the existing rounding", () => {
		expect(
			projectProgress([
				{ status: "DONE" },
				{ status: "IN_PROGRESS" },
				{ status: "TODO" },
			]),
		).toEqual({ progress: 33, taskStats: { total: 3, done: 1 } });
	});
	test("all completed tasks yield 100 percent", () => {
		expect(projectProgress([{ status: "DONE" }, { status: "DONE" }])).toEqual({
			progress: 100,
			taskStats: { total: 2, done: 2 },
		});
	});
});
