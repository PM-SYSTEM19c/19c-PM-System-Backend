import { z } from "zod";

export const createTaskSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  title: z.string().min(1, "Title is required").max(300),
  description: z.string().optional().nullable(),
  departmentId: z.string().min(1, "Department ID is required"),
  assigneeId: z.string().min(1, "Assignee is required"),
  clientVisible: z.boolean().default(false),
});

/**
 * Snapshot of editable fields as the client saw them when it started editing.
 * Used for a safe field-level (3-way) merge when `version` is stale:
 * if nobody else touched the fields this client is changing, the edit is merged
 * onto the latest version instead of being rejected with 409.
 */
const taskBaselineSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().nullable().optional(),
    departmentId: z.string().optional(),
    assigneeId: z.string().nullable().optional(),
    clientVisible: z.boolean().optional(),
  })
  .strict();

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  description: z.string().optional().nullable(),
  departmentId: z.string().min(1).optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  clientVisible: z.boolean().optional(),
  version: z.number().int().min(1, "Version is required"),
  baseline: taskBaselineSchema.optional(),
});

export const updateTaskStatusSchema = z.object({
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]),
  version: z.number().int().min(1, "Version is required"),
  /**
   * Status the client saw. When `version` is stale but the status itself has not
   * changed (e.g. only the description was edited), the transition is still safe.
   */
  expectedStatus: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
});

export const addDependencySchema = z.object({
  dependsOnTaskId: z.string().min(1, "Depends on Task ID is required"),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type AddDependencyInput = z.infer<typeof addDependencySchema>;
