import type { Role } from "@prisma/client";

// Authenticated user context attached to requests
export interface AuthUser {
	id: string;
	role: Role;
	departmentId: string | null;
}

// Pagination query params
export interface PaginationParams {
	page: number;
	pageSize: number;
	search?: string;
	sort?: string;
	order?: "asc" | "desc";
}

// Generic filter map
export type FilterMap = Record<string, string | string[] | undefined>;

// Typed Hono context variables (c.get("user") / c.set("user"))
declare module "hono" {
	interface ContextVariableMap {
		user: AuthUser;
	}
}
