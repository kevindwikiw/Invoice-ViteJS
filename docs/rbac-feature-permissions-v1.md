# RBAC Feature Permissions v1

## Summary
This v1 introduces granular feature permissions using **Role + User Override** to support selective access for employees without creating more role types.

Pilot scope:
- `view_market_insights`
- `view_billing_history`
- `edit_billing_history`

Permission assignment owner:
- `superadmin`
- `admin`

## Scope and Goals
- Keep existing role system (`superadmin`, `admin`, `employee`).
- Add per-user override to grant/deny specific feature access.
- Enforce on both backend and frontend (defense in depth).
- Keep current business flows stable outside pilot scope.

Out of scope (v1):
- New role creation workflow.
- Permission groups/templates.
- Audit trail UI for permission changes.

## Permission Matrix (Role Defaults)
| Role | view_market_insights | view_billing_history | edit_billing_history |
|---|---|---|---|
| superadmin | true | true | true |
| admin | true | true | true |
| employee | false | true | false |

## Override Model and Precedence
- Storage model: table `user_permissions` with one row per `(user_id, permission_key)`.
- `effect` values: `grant` or `deny`.
- In UI/API, `inherit` means no explicit row.

Precedence:
1. Explicit `deny`
2. Explicit `grant`
3. Role default

## Data Model
### New table: `user_permissions`
- `id` (PK)
- `user_id` (int, not null)
- `permission_key` (text, not null)
- `effect` (text, check: `grant|deny`)
- `created_at` (timestamp default current)
- Unique constraint: `(user_id, permission_key)`

## API Contracts
### `GET /api/users/:id/permissions`
Returns effective and override states for a user.

Response:
```json
{
  "userId": 12,
  "role": "employee",
  "permissions": [
    { "key": "view_market_insights", "override": "deny", "effective": false },
    { "key": "view_billing_history", "override": "inherit", "effective": true },
    { "key": "edit_billing_history", "override": "grant", "effective": true }
  ],
  "permissionOverrides": {
    "view_market_insights": "deny",
    "edit_billing_history": "grant"
  },
  "featurePermissions": {
    "view_market_insights": false,
    "view_billing_history": true,
    "edit_billing_history": true
  }
}
```

Access rules:
- self-read allowed.
- `admin`/`superadmin` can read any non-superadmin target.
- `admin` cannot read superadmin target.

### `PUT /api/users/:id/permissions`
Atomic replace of user overrides.

Request:
```json
{
  "overrides": {
    "view_market_insights": "inherit",
    "view_billing_history": "grant",
    "edit_billing_history": "deny"
  }
}
```

Response:
```json
{
  "status": "updated",
  "userId": 12,
  "permissionOverrides": {
    "view_billing_history": "grant",
    "edit_billing_history": "deny"
  },
  "featurePermissions": {
    "view_market_insights": false,
    "view_billing_history": true,
    "edit_billing_history": false
  }
}
```

Access rules:
- only `admin`/`superadmin`.
- `admin` cannot modify superadmin target.

## Frontend Integration
- Extend permission union in `client/src/context/auth.tsx`.
- `hasPermission()` evaluates:
  - explicit override deny/grant from user profile
  - fallback to role defaults
- Sync permission profile:
  - after login
  - after token refresh event
  - on app boot if missing in local user cache

### Team Directory UX
- Add `Feature Access` panel per member.
- Controls per permission:
  - Inherited
  - Grant
  - Deny
- Show resulting state badge:
  - `Allowed` / `Blocked`

## Enforcement Points (v1)
- Sidebar:
  - hide Market Insights if no `view_market_insights`
  - hide Billing History if no `view_billing_history`
- Analytics page:
  - frontend guard + backend guard (`/api/analytics`, `/api/analytics/target`)
- Billing history edit:
  - disable edit action if no `edit_billing_history`
  - backend deny on `PUT /api/invoices/:id` and proof upload route
- Billing history viewing:
  - frontend page guard + backend guards on invoice history endpoints

## Acceptance Criteria
1. Superadmin/Admin/Employee inherit defaults exactly as matrix.
2. Override `deny` always blocks even if role default is allowed.
3. Override `grant` allows feature for user even if role default denies.
4. Employee without `view_market_insights` cannot open analytics route/API.
5. User without `edit_billing_history` cannot trigger invoice update API.
6. Team Directory can save and reload permission overrides successfully.
7. Existing legacy permissions continue to work (`manage_users`, etc.).

## Test Matrix
- Role defaults:
  - superadmin/admin/employee with no overrides.
- Override combinations:
  - grant only, deny only, mixed keys, inherit reset.
- Route/API defense:
  - UI hidden + direct URL blocked + API 403.
- Session behavior:
  - login gets profile
  - token refresh keeps/updates permission state

## Rollback Strategy
- Soft rollback:
  - stop writing overrides, keep table.
  - disable feature checks by short-circuiting evaluator to role defaults.
- Hard rollback:
  - remove evaluator calls in routes/sidebar/pages.
  - keep table untouched for later re-enable.
