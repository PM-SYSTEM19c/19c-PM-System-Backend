# PM System — Backend Architecture & Developer Handoff Guide

## 1. System Overview

- **Runtime:** Bun v1.4+
- **Framework:** Hono v4 (Lightweight, web-standards compliant)
- **Database & ORM:** PostgreSQL 16+ via Prisma ORM
- **Authentication:** JWT validation uses the user's current database role and department. Logout revocation is process-local (`src/lib/jwt.ts`); it does not persist across restarts or multiple instances.
- **Security:** Layered rate limiting, trusted proxy IP resolution, strict CORS, and security response headers.

---

## 2. Directory Structure & Module Layering

Domain features live in `src/modules/<feature>/`. Most follow route/controller/service/schema layering; attachment and trash routes still contain HTTP orchestration directly.

```
src/
├── config/                  # Environment variables and constants
├── lib/                     # Database (Prisma), pooling, and db-hardening
├── middlewares/             # Auth, role authorization, and rate limiters
├── modules/
│   ├── attachments/         # Task file uploads, response MIME policy, and physical disk retrieval
│   ├── auth/                # Login, registration, token generation & revocation
│   ├── client/              # Masked client portal queries
│   ├── departments/         # Department management and assignment
│   ├── positions/           # Organizational roles and functional titles
│   ├── projects/            # Project scoping, department assignment, and progress
│   ├── standups/            # Daily standup summaries & automated aggregation
│   ├── tasks/               # Core task board, dependencies, concurrency & audit logs
│   ├── trash/               # Soft-delete recovery and restoration (PM only)
│   └── users/               # User directory, approvals, and profile management
├── routes/
│   └── index.ts             # Central API routing hub (/api/v1/*)
├── shared/
│   ├── errors/              # Domain errors (AppError, NotFoundError, ValidationError, etc.)
│   ├── response.ts          # Standardized API response formatters (ApiResponse<T>)
│   ├── types/               # Common interfaces (AuthUser, PaginationParams)
│   └── utils/               # Parameter extraction, pagination utilities
├── app.ts                   # Hono application factory & global error handler (app.onError)
└── server.ts                # Server startup, DB hardening, and standup scheduler
```

### Layer Responsibilities

| Layer | File Pattern | Responsibilities |
|---|---|---|
| **Routing** | `<feature>.route.ts` | Route registration, middleware pipeline (`authMiddleware`, `pmOnly`, `internalOnly`), parameter extraction. |
| **Controller** | `<feature>.controller.ts` | HTTP request handling, Zod schema validation, invoking services, returning `successResponse(c, data, status)`. |
| **Service** | `<feature>.service.ts` | Domain logic, database queries via `prisma`, cross-entity authorization, transaction boundaries. |
| **Schema** | `<feature>.schema.ts` | Zod input validation schemas and inferred TypeScript types (`Create*Input`, `Update*Input`). |

---

## 3. Core Business Rules & Access Control (3-Dimensional Matrix)

Access control is enforced across 3 distinct dimensions:

1. **Dimension 1 — Role Hierarchy:**
   - `PM`: Superuser with full visibility, assignment powers, project creation, trash recovery, and standup generation.
   - `INTERNAL`: Organization members assigned to specific departments.
   - `CLIENT`: External clients strictly isolated to their own projects. Internal identities, standup logs, and employee details are masked at the API level.

2. **Dimension 2 — Department Scoping:**
   - Internal employees can only view or manage tasks within their assigned department, unless explicitly assigned to a specific cross-department task.

3. **Dimension 3 — State Transition & Dependency Blocking:**
   - Tasks cannot be transitioned from `TODO` to `IN_PROGRESS` or `DONE` if unresolved prerequisite dependencies exist (`effectiveStatus = BLOCKED`).
   - A `DONE` prerequisite cannot be reopened if dependent tasks are already active.
   - Optimistic concurrency control uses row versioning (`version`) to prevent concurrent overwrites (HTTP 409 `VERSION_CONFLICT`).

---

## 4. Audit Trail & Data Protection

- **Soft Delete:** Business records (`tasks`, `projects`, `departments`, `positions`, `attachments`) use `deletedAt: DateTime?`. Physical deletion is blocked by database triggers and soft-delete conventions.
- **Immutable Audit Trail:** `task_audit_logs` record every change. Updates and deletions on audit tables are rejected by PostgreSQL triggers.

---

## 5. Developer Verification Commands

```bash
# Type check TypeScript codebase
bunx tsc --noEmit

# Run database-independent unit/regression tests
bun run test:unit

# Run code style & linting checks
bunx @biomejs/biome check src/
```

## 6. Safe verification and maintenance

- `bun run lint` checks source without editing it; `bun run lint:fix` applies formatter/import fixes explicitly.
- `createAuthMiddleware` accepts a user-lookup function for deterministic tests. Its default still uses the same soft-delete filter and database permissions. Only JWT verification failures become `401`; infrastructure failures reach the global error handler.
- `shared/utils/project-progress.ts` owns the existing DONE/total percentage and rounding rule for internal and client project APIs.
- `USER_PROFILE_SELECT` keeps user-list/detail/update response fields consistent and excludes password hashes.
- `attachments/attachment.policy.ts` contains the unchanged 10 MB limit and allowed upload types. Download MIME metadata is constrained to that policy; unknown/active metadata becomes `application/octet-stream`.
- Attachment routes additionally accept the frontend HttpOnly session cookie via native external rewrites. Production accepts only `__Host-pms-session`; development uses `pms-session`. Cookie credentials are not accepted on unrelated routes. JWT/revocation/current-account checks and role/project/department permissions remain authoritative. Cookie writes require exact `CORS_ORIGIN` membership, session-bound HMAC CSRF, and non-cross-site Fetch Metadata. Bearer API clients retain their existing transport.
- `attachment.body-limit.ts` bounds actual request bytes before multipart parsing, including streams and misleading Content-Length headers. The total request cap is 11 MiB, leaving overhead for the unchanged 10 MiB file limit. Attachment responses are private/no-store.
- `proxy-client-ip.ts` accepts visitor IP only when metadata is HMAC-signed with the same server-only `API_PROXY_SECRET` as Vercel, bound to method/path and within 30 seconds. Invalid metadata never overrides the existing edge-IP fallback. This preserves separate per-visitor login quotas without trusting plain browser IP headers; quotas/revocation are still in memory.
- `.dockerignore` excludes local environment files and host dependencies. Supply production credentials through the deployment environment.

### Runtime uploads and demo accounts before deployment

- `/uploads/` is ignored by Git because its files are runtime user data, not application source. Removing files from the Git index does not delete local files or remove copies in older commits.
- `attachment.storage.ts` creates the runtime uploads directory recursively on the first authorized, validated physical upload. The path remains `process.cwd()/uploads` (`/app/uploads` in the current Dockerfile); names, URLs, file limits, and business records are unchanged. Existing files are preserved and exclusive `wx` writes still reject collisions. Storage/permission failures are surfaced, not hidden by a fallback location.
- Directory creation is not persistent storage. Without a volume/object store, container replacement can lose new uploads. Attaching a volume or moving files requires a separate deployment/storage decision; no paid service is provisioned by this helper.
- Before deploying a new checkout, back up production uploads and verify that the existing `/app/uploads` path is backed by persistent storage. A clean Git checkout no longer supplies the previously tracked upload files. Do not deploy the untracking change until attachment availability is verified; do not rewrite Git history without separate approval.
- Local upload backups live outside this repository in the workspace's ignored `.local-backups/` directory. They are not a verified production backup.
- `prisma/seed.ts` defines 13 demo accounts with a shared documented password. Its upserts use `update: {}`, so rerunning seed does not reset an existing account's password. Source review alone cannot establish whether those accounts exist or still use that password in production.
- Do not run seed against production as a security check. Inventory production accounts read-only first; any password reset or account deactivation requires explicit approval.

### Database-backed E2E tests

The E2E suites create, update, soft-delete, restore, and attempt trigger-protected SQL operations. They must run on a disposable seeded database, not the development workspace database or production.

1. Create a new local test database and set `DATABASE_URL` to it for **both** the server and the test command.
2. Apply the existing schema with `bunx prisma db push --skip-generate`, then run `bun run db:seed`. Generate Prisma separately if the client is not already installed.
3. Start a separate API process with `PORT=3002`, `NODE_ENV=test`, `STANDUP_SCHEDULER=off`, and a test-only JWT secret. Wait for DB hardening to succeed.
4. Set `API_URL=http://localhost:3002/api/v1` in the test process and run `bun run test:e2e`.
5. Stop that API process, then remove only the disposable database created for the test.

Both E2E suites and attachment security tests honor `API_URL`. The existing fallback is still port 3000, so setting it explicitly is required for isolated runs.

### Boundaries needing a product/deployment decision

Current internal task reads are scoped by project department membership. The standalone `canViewTask` helper describes a narrower same-department/assignee policy but is not used in the read services. Do not silently replace the implemented project view with that helper during refactoring; agree the intended policy first.

Token revocation/rate limits remain in memory, and uploaded files remain local disk data. Persistent session storage, shared rate limits, file signature scanning, and object storage require a separate deployment design. The schema and business rules were not migrated during this review.
