import {
	BuildQueryFilter,
	extractQueryFromParams,
	type FilteringQuery,
	type PrismaOrderBy,
	type PrismaWhereCondition,
} from "@nodewave/prisma-ezfilter";
import { PAGINATION } from "../../config/constants";
import { ValidationError } from "../errors";

/**
 * Per-endpoint specification for list queries.
 * Only whitelisted fields can be filtered / searched / sorted, so clients
 * cannot probe arbitrary (possibly sensitive) columns.
 */
export interface ListQuerySpec {
	/** Fields allowed in exact-match filters, e.g. filter[status]=DONE */
	filterable: string[];
	/** Fields included in free-text `search` (OR, case-insensitive contains) */
	searchable: string[];
	/** Fields allowed as sort key */
	sortable: string[];
	/** Default sort key */
	defaultSort?: string;
}

export interface ListQueryResult {
	where: PrismaWhereCondition;
	orderBy: PrismaOrderBy | PrismaOrderBy[];
	skip: number;
	take: number;
	page: number;
	pageSize: number;
}

type RawQuery = Record<string, string | undefined>;

/**
 * Convert request query params into a Prisma query using @nodewave/prisma-ezfilter.
 *
 * Accepted formats (can be mixed):
 * - Legacy / frontend:  filter[status]=DONE&search=foo&sort=createdAt&order=desc&page=1&pageSize=20
 * - Native ezfilter:    filters={"status":"DONE"}&searchFilters={"title":"foo"}&orderKey=createdAt&orderRule=desc&page=1&rows=20
 */
export function buildListQuery(
	query: RawQuery,
	spec: ListQuerySpec,
): ListQueryResult {
	// 1. Native ezfilter params (JSON strings)
	let native: FilteringQuery = {};
	try {
		native = extractQueryFromParams(query);
	} catch {
		throw new ValidationError("Invalid filter parameters");
	}

	// 2. Legacy filter[x]=y params
	const filters: Record<string, unknown> = { ...(native.filters ?? {}) };
	for (const [key, value] of Object.entries(query)) {
		const field = key.match(/^filter\[(\w+)]$/)?.[1];
		if (field && value) filters[field] = value;
	}

	// Whitelist filter fields (ezfilter only warns on unknown fields)
	const safeFilters: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(filters)) {
		if (spec.filterable.includes(key) && value !== undefined && value !== "") {
			// Query strings are untyped: coerce "true"/"false" to booleans for boolean columns
			safeFilters[key] =
				value === "true" ? true : value === "false" ? false : value;
		}
	}

	// 3. Search: legacy `search` fans out to all searchable fields
	const searchFilters: Record<string, unknown> = {};
	const search = query.search?.trim();
	if (search) {
		for (const field of spec.searchable) searchFilters[field] = search;
	}
	for (const [key, value] of Object.entries(native.searchFilters ?? {})) {
		if (spec.searchable.includes(key) && value) searchFilters[key] = value;
	}

	// 4. Ordering
	const requestedSort = native.orderKey ?? query.sort;
	const orderKey =
		requestedSort && spec.sortable.includes(requestedSort)
			? requestedSort
			: (spec.defaultSort ?? "createdAt");
	const rawRule = native.orderRule ?? query.order;
	const orderRule: "asc" | "desc" = rawRule === "asc" ? "asc" : "desc";

	// 5. Pagination (clamped instead of rejected for better UX)
	const page = Math.max(
		1,
		Number(native.page ?? query.page) || PAGINATION.DEFAULT_PAGE,
	);
	const pageSize = Math.min(
		PAGINATION.MAX_PAGE_SIZE,
		Math.max(
			1,
			Number(native.rows ?? query.pageSize) || PAGINATION.DEFAULT_PAGE_SIZE,
		),
	);

	const builder = new BuildQueryFilter({
		allowedFields: [
			...new Set([...spec.filterable, ...spec.searchable, ...spec.sortable]),
		],
		maxPageSize: PAGINATION.MAX_PAGE_SIZE,
		defaultPageSize: PAGINATION.DEFAULT_PAGE_SIZE,
		defaultSearchMode: "insensitive",
	});

	const rangedFilters = (native.rangedFilters ?? []).filter((r) =>
		spec.filterable.includes(r.key),
	);

	const { query: built, validation } = builder.build({
		filters: safeFilters,
		searchFilters,
		rangedFilters,
		orderKey,
		orderRule,
		page,
		rows: pageSize,
	});

	if (!validation.isValid) {
		throw new ValidationError("Invalid list query", validation.errors);
	}

	return {
		where: built.where ?? {},
		orderBy: built.orderBy ?? { [orderKey]: orderRule },
		skip: built.skip,
		take: built.take,
		page,
		pageSize,
	};
}
