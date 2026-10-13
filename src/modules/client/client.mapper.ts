/**
 * Client Data Mapper
 *
 * Strips all internal/sensitive fields from responses sent to CLIENT role.
 * This is the backend-level data masking — NOT frontend filtering.
 *
 * Never return: assignee, department, internal comments, audit logs
 */

import type { Project, Task } from "@prisma/client";

type TaskEntity = Pick<
	Task,
	"id" | "title" | "status" | "clientVisible" | "createdAt" | "updatedAt"
>;
type ProjectEntity = Pick<Project, "id" | "name" | "description">;

/**
 * Map a task to a safe client-facing DTO
 * Strips: assignee, department, assigneeId, departmentId, version, audit logs
 */
export function toClientTask(task: TaskEntity) {
	return {
		id: task.id,
		title: task.title,
		status: task.status,
		createdAt: task.createdAt,
		updatedAt: task.updatedAt,
	};
}

/**
 * Map a project to a safe client-facing DTO with progress
 */
export function toClientProject(project: ProjectEntity, progress: number) {
	return {
		id: project.id,
		name: project.name,
		description: project.description,
		progress,
	};
}

/**
 * Filter tasks to only include client-visible ones, then map to safe DTOs
 */
export function toClientTaskList(tasks: TaskEntity[]) {
	return tasks.filter((task) => task.clientVisible).map(toClientTask);
}
