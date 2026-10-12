import { z } from "zod";

export const createPositionSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(100),
	description: z.string().trim().max(500).optional().nullable(),
});

export const updatePositionSchema = z.object({
	name: z.string().trim().min(1, "Name is required").max(100).optional(),
	description: z.string().trim().max(500).optional().nullable(),
});

export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
