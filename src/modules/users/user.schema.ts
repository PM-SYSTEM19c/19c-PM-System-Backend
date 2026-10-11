import { z } from "zod";

export const updateUserSchema = z
	.object({
		name: z.string().trim().min(1, "Name cannot be empty").max(100).optional(),
		departmentId: z.string().nullable().optional(),
		positionId: z.string().nullable().optional(),
		position: z.string().nullable().optional(),
		role: z.enum(["PM", "INTERNAL", "CLIENT"]).optional(),
		status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
	})
	.strict();

export type UpdateUserInput = z.infer<typeof updateUserSchema>;
