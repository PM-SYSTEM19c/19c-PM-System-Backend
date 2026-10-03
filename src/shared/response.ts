import type { Context } from "hono";

// Standardized API response structure
export interface ApiResponse<T = unknown> {
	success: boolean;
	data?: T;
	error?: {
		code: string;
		message: string;
		details?: unknown;
	};
	meta?: {
		page: number;
		pageSize: number;
		total: number;
		totalPages: number;
	};
}

export function successResponse<T>(c: Context, data: T, status: number = 200) {
	return c.json<ApiResponse<T>>({ success: true, data }, status as any);
}

export function paginatedResponse<T>(
	c: Context,
	data: T,
	meta: { page: number; pageSize: number; total: number },
) {
	return c.json<ApiResponse<T>>({
		success: true,
		data,
		meta: {
			...meta,
			totalPages: Math.ceil(meta.total / meta.pageSize),
		},
	});
}

export function errorResponse(
	c: Context,
	code: string,
	message: string,
	status: number = 400,
	details?: unknown,
) {
	return c.json<ApiResponse>(
		{
			success: false,
			error: { code, message, ...(details ? { details } : {}) },
		},
		status as any,
	);
}
