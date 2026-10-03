import { prisma } from "../../lib/prisma";
import { AppError, NotFoundError } from "../../shared/errors";
import type { CreateDepartmentInput, UpdateDepartmentInput } from "./department.schema";

export class DepartmentService {
  async findAll() {
    return prisma.department.findMany({
      where: { deletedAt: null },
      orderBy: { name: "asc" },
      include: {
        users: {
          where: { deletedAt: null },
          select: { id: true, name: true, email: true, position: true, role: true },
        },
      },
    });
  }

  async findById(id: string) {
    const department = await prisma.department.findFirst({
      where: { id, deletedAt: null },
    });
    if (!department) throw new NotFoundError("Department", id);
    return department;
  }

  async create(input: CreateDepartmentInput) {
    return prisma.department.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description,
      },
    });
  }

  async update(id: string, input: UpdateDepartmentInput) {
    await this.findById(id);
    return prisma.department.update({
      where: { id },
      data: input,
    });
  }

  async softDelete(id: string) {
    await this.findById(id);

    // Guard: don't orphan active people or work under a hidden department
    const [members, openTasks] = await Promise.all([
      prisma.user.count({ where: { departmentId: id, deletedAt: null } }),
      prisma.task.count({
        where: { departmentId: id, deletedAt: null, status: { not: "DONE" } },
      }),
    ]);
    if (members > 0 || openTasks > 0) {
      throw new AppError(
        "DEPARTMENT_IN_USE",
        409,
        `Department still has ${members} member(s) and ${openTasks} unfinished task(s). Move or finish them first.`,
      );
    }

    return prisma.department.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }
}

export const departmentService = new DepartmentService();
