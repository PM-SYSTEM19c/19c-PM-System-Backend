import type { Context } from "hono";
import { ValidationError } from "../errors";

/**
 * Read a required route param in a strict-TS-safe way.
 * Throws a 400 ValidationError instead of passing `undefined` downstream.
 */
export function getParam(c: Context<any, any, any>, name: string): string {
	const value = c.req.param(name) as string | undefined;
	if (!value) throw new ValidationError(`Missing route param: ${name}`);
	return value;
}
