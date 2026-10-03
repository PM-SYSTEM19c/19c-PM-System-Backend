import { prisma } from "../../lib/prisma";
import { ForbiddenError, NotFoundError } from "../../shared/errors";
import type { AuthUser } from "../../shared/types";
import type { ListQueryResult } from "../../shared/utils/pagination";
import type { CreateProjectInput, UpdateProjectInput } from "./project.schema";

export class ProjectService {
	/**
	 * List projects accessible by current user
	 */
	async findAll(user: AuthUser, listQuery: ListQueryResult) {
		const { skip, take, orderBy } = listQuery;

		const scope: any = { deletedAt: null };

		if (user.role === "CLIENT") {
			// Client can only see their own projects
			scope.clientId = user.id;
		} else if (user.role === "INTERNAL") {
			// Internal user can only see projects their department is assigned to
			scope.departments = {
				some: { departmentId: user.departmentId, deletedAt: null },
			};
		}
		// PM can see all projects

		// Filters & search are built by @nodewave/prisma-ezfilter; role scope is AND-ed
		const whereClause: any = { AND: [scope, listQuery.where] };

		const [projects, total] = await Promise.all([
			prisma.project.findMany({
				where: whereClause,
				skip,
				take,
				orderBy: orderBy as any,
				include: {
					client: { select: { name: true } },
					_count: {
						select: {
							tasks: { where: { deletedAt: null } },
							departments: { where: { deletedAt: null } },
						},
					},
					tasks: {
						where: { deletedAt: null },
						select: { status: true },
					},
				},
			}),
			prisma.project.count({ where: whereClause }),
		]);

		// Calculate progress for each project
		const projectsWithProgress = projects.map((project) => {
			const totalTasks = project.tasks.length;
			const doneTasks = project.tasks.filter((t) => t.status === "DONE").length;
			const progress =
				totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

			const { tasks, ...rest } = project;
			return {
				...rest,
				progress,
				taskStats: { total: totalTasks, done: doneTasks },
			};
		});

		return { data: projectsWithProgress, total };
	}

	/**
	 * Get project by ID with access control
	 */
	async findById(projectId: string, user: AuthUser) {
		const project = await prisma.project.findFirst({
			where: { id: projectId, deletedAt: null },
			include: {
				client: { select: { name: true, email: true } },
				departments: {
					where: { deletedAt: null },
					include: {
						department: {
							include: {
								users: {
									where: { deletedAt: null },
									select: {
										id: true,
										name: true,
										email: true,
										role: true,
										position: true,
										departmentId: true,
									},
								},
							},
						},
					},
				},
				tasks: {
					where: { deletedAt: null },
					select: { status: true },
				},
			},
		});

		if (!project) throw new NotFoundError("Project", projectId);

		// Access control
		await this.checkProjectAccess(projectId, user);

		const totalTasks = project.tasks.length;
		const doneTasks = project.tasks.filter((t) => t.status === "DONE").length;
		const progress =
			totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

		const { tasks, ...rest } = project;
		return {
			...rest,
			progress,
			taskStats: { total: totalTasks, done: doneTasks },
		};
	}

	/**
	 * Create a new project (PM only)
	 */
	async create(input: CreateProjectInput, _userId: string) {
		const project = await prisma.project.create({
			data: {
				name: input.name,
				description: input.description,
				clientId: input.clientId,
			},
		});

		return project;
	}

	/**
	 * Update project (PM only)
	 */
	async update(projectId: string, input: UpdateProjectInput) {
		const project = await prisma.project.findFirst({
			where: { id: projectId, deletedAt: null },
		});
		if (!project) throw new NotFoundError("Project", projectId);

		return prisma.project.update({
			where: { id: projectId },
			data: input,
		});
	}

	/**
	 * Soft delete project (PM only)
	 */
	async softDelete(projectId: string) {
		const project = await prisma.project.findFirst({
			where: { id: projectId, deletedAt: null },
		});
		if (!project) throw new NotFoundError("Project", projectId);

		return prisma.project.update({
			where: { id: projectId },
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Add department to project (PM only)
	 */
	async addDepartment(projectId: string, departmentId: string) {
		const project = await prisma.project.findFirst({
			where: { id: projectId, deletedAt: null },
		});
		if (!project) throw new NotFoundError("Project", projectId);

		const department = await prisma.department.findFirst({
			where: { id: departmentId, deletedAt: null },
		});
		if (!department) throw new NotFoundError("Department", departmentId);

		return prisma.projectDepartment.upsert({
			where: {
				projectId_departmentId: { projectId, departmentId },
			},
			// Re-adding a soft-removed department revives the existing row
			update: { deletedAt: null },
			create: { projectId, departmentId },
		});
	}

	/**
	 * Remove department from project (PM only)
	 */
	async removeDepartment(projectId: string, departmentId: string) {
		const project = await prisma.project.findFirst({
			where: { id: projectId, deletedAt: null },
		});
		if (!project) throw new NotFoundError("Project", projectId);

		const link = await prisma.projectDepartment.findFirst({
			where: { projectId, departmentId, deletedAt: null },
		});
		if (!link) throw new NotFoundError("ProjectDepartment", departmentId);

		// Soft delete — the link row is kept for history
		return prisma.projectDepartment.update({
			where: {
				projectId_departmentId: { projectId, departmentId },
			},
			data: { deletedAt: new Date() },
		});
	}

	/**
	 * Check if user has access to a project
	 */
	async checkProjectAccess(projectId: string, user: AuthUser) {
		if (user.role === "PM") return; // PM has access to all projects
		if (user.role === "CLIENT") {
			const project = await prisma.project.findUnique({
				where: { id: projectId },
			});
			if (project?.clientId !== user.id)
				throw new ForbiddenError("You are not a client of this project");
			return;
		}

		if (!user.departmentId)
			throw new ForbiddenError(
				"You must belong to a department to access projects",
			);

		const membership = await prisma.projectDepartment.findFirst({
			where: { projectId, departmentId: user.departmentId, deletedAt: null },
		});

		if (!membership) {
			throw new ForbiddenError(
				"Your department is not assigned to this project",
			);
		}
	}
}

export const projectService = new ProjectService();
