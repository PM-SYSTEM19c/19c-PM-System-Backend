import { z } from "zod";

export const createProjectSchema = z.object({
	name: z.string().min(1, "Project name is required").max(200),
	description: z.string().optional().nullable(),
	clientId: z.string().optional().nullable(),
});

export const updateProjectSchema = z.object({
	name: z.string().min(1).max(200).optional(),
	description: z.string().optional().nullable(),
	clientId: z.string().optional().nullable(),
});

export const addMemberSchema = z.object({
	userId: z.string().min(1, "User ID is required"),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;
export type AddMemberInput = z.infer<typeof addMemberSchema>;
