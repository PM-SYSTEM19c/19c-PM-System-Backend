/**
 * Client Data Mapper
 *
 * Strips all internal/sensitive fields from responses sent to CLIENT role.
 * This is the backend-level data masking — NOT frontend filtering.
 *
 * Never return: assignee, department, internal comments, audit logs
 */

interface TaskEntity {
	id: string;
	title: string;
	status: string;
	clientVisible: boolean;
	createdAt: Date;
	updatedAt: Date;
	[key: string]: any;
}

interface ProjectEntity {
	id: string;
	name: string;
	description: string | null;
	[key: string]: any;
}

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
