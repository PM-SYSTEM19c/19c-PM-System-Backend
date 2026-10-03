import { prisma } from "../../lib/prisma";
import { NotFoundError, ForbiddenError } from "../../shared/errors";
import { toClientProject, toClientTask, toClientTaskList } from "./client.mapper";

/**
 * Client Service — Dedicated service for CLIENT role
 *
 * All responses go through client.mapper to strip sensitive data.
 * Client can only see:
 * - Their own projects (via clientId or project membership)
 * - Tasks marked as clientVisible = true
 * - Safe fields only (no assignee, department, audit, etc.)
 */
export class ClientService {
  /**
   * Get all projects belonging to the client
   */
  async getProjects(clientId: string) {
    const projects = await prisma.project.findMany({
      where: {
        deletedAt: null,
        clientId: clientId,
      },
      include: {
        tasks: {
          where: { deletedAt: null },
          select: { status: true },
        },
      },
    });

    return projects.map((project) => {
      const totalTasks = project.tasks.length;
      const doneTasks = project.tasks.filter((t) => t.status === "DONE").length;
      const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

      return toClientProject(project, progress);
    });
  }

  /**
   * Get a single project with progress (client-safe)
   */
  async getProjectById(projectId: string, clientId: string) {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        deletedAt: null,
        clientId: clientId,
      },
      include: {
        tasks: {
          where: { deletedAt: null },
          select: { status: true },
        },
      },
    });

    if (!project) {
      throw new NotFoundError("Project", projectId);
    }

    const totalTasks = project.tasks.length;
    const doneTasks = project.tasks.filter((t) => t.status === "DONE").length;
    const progress = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

    return toClientProject(project, progress);
  }

  /**
   * Get client-visible tasks for a project (safe fields only)
   */
  async getProjectTasks(projectId: string, clientId: string) {
    // Verify client has access to this project
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        clientId: clientId,
        deletedAt: null,
      },
    });

    if (!project) {
      throw new ForbiddenError("You don't have access to this project");
    }

    const tasks = await prisma.task.findMany({
      where: {
        projectId,
        deletedAt: null,
        clientVisible: true,
      },
      orderBy: { createdAt: "asc" },
    });

    return tasks.map(toClientTask);
  }
}

export const clientService = new ClientService();
