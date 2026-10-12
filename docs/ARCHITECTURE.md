# PM System — Backend Architecture & Developer Handoff Guide

## 1. System Overview

- **Runtime:** Bun v1.4+
- **Framework:** Hono v4 (Lightweight, web-standards compliant)
- **Database & ORM:** PostgreSQL 16+ via Prisma ORM
- **Authentication:** JWT with in-memory revocation registry for secure logout (`src/modules/auth/auth.service.ts`)
- **Security:** Layered rate limiting, trusted proxy IP resolution, strict CORS, and security response headers.

---

## 2. Directory Structure & Module Layering

Every domain feature is organized inside `src/modules/<feature>/` following a consistent 4-layer architecture:

```
src/
├── config/                  # Environment variables and constants
├── lib/                     # Database (Prisma), pooling, and db-hardening
├── middlewares/             # Auth, role authorization, and rate limiters
├── modules/
│   ├── attachments/         # Task file uploads and physical disk streaming
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
└── server.ts                # Bun server entry point with graceful shutdown
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

# Run unit and integration tests (70 passing tests)
bun test

# Run code style & linting checks
bunx @biomejs/biome check src/
```
