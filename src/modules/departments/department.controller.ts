import type { Context } from "hono";
import { getParam } from "../../shared/utils/params";
import { departmentService } from "./department.service";
import { createDepartmentSchema, updateDepartmentSchema } from "./department.schema";
import { successResponse } from "../../shared/response";
import { ValidationError } from "../../shared/errors";

export class DepartmentController {
  async findAll(c: Context) {
    const departments = await departmentService.findAll();
    return successResponse(c, departments);
  }

  async findById(c: Context) {
    const id = getParam(c, "id");
    const department = await departmentService.findById(id);
    return successResponse(c, department);
  }

  async create(c: Context) {
    const body = await c.req.json();
    const parsed = createDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }
    const department = await departmentService.create(parsed.data);
    return successResponse(c, department, 201);
  }

  async update(c: Context) {
    const id = getParam(c, "id");
    const body = await c.req.json();
    const parsed = updateDepartmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Validation failed", parsed.error.flatten().fieldErrors);
    }
    const department = await departmentService.update(id, parsed.data);
    return successResponse(c, department);
  }

  async delete(c: Context) {
    const id = getParam(c, "id");
    await departmentService.softDelete(id);
    return successResponse(c, { message: "Department deleted successfully" });
  }
}

export const departmentController = new DepartmentController();
