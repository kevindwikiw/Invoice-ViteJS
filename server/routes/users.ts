import { Hono } from "hono";
import { Database } from "bun:sqlite";

const users = new Hono();
const sqlite = new Database("db/sqlite.db");

// Get all users (filter out superadmin for non-superadmin)
users.get("/", async (c) => {
    const currentUser = c.get("user");

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    // Only admin and superadmin can list users
    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        let query = "SELECT id, email, name, role, created_at FROM users";

        // If current user is admin (not superadmin), hide superadmin users
        if (currentUser.role === "admin") {
            query += " WHERE role != 'superadmin'";
        }

        const result = sqlite.query(query).all();
        return c.json(result);
    } catch (e) {
        return c.json({ error: String(e) }, 500);
    }
});

// Create user
users.post("/", async (c) => {
    const currentUser = c.get("user");

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    // Only admin and superadmin can create users
    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const { email, name, password, role } = await c.req.json();

        if (!email || !name || !password) {
            return c.json({ error: "Email, name, and password are required" }, 400);
        }

        // Admin cannot create superadmin
        if (currentUser.role === "admin" && role === "superadmin") {
            return c.json({ error: "Permission denied" }, 403);
        }

        // Check if email exists
        const existing = sqlite.query("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
        if (existing) {
            return c.json({ error: "Email already exists" }, 400);
        }

        // Validate role - whitelist only valid roles
        const validRoles = ["superadmin", "admin", "employee"];
        const userRole = role || "employee";
        if (!validRoles.includes(userRole)) {
            return c.json({ error: "Invalid role. Must be: superadmin, admin, or employee" }, 400);
        }

        // Hash password
        const passwordHash = await Bun.password.hash(password, {
            algorithm: "bcrypt",
            cost: 10,
        });

        // Insert user
        const result = sqlite.prepare(`
            INSERT INTO users (email, name, password_hash, role)
            VALUES (?, ?, ?, ?)
        `).run(email.toLowerCase(), name, passwordHash, userRole);

        return c.json({
            id: Number(result.lastInsertRowid),
            email: email.toLowerCase(),
            name,
            role: role || "employee",
        });
    } catch (e) {
        console.error("Create user error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

// Delete user
users.delete("/:id", async (c) => {
    const currentUser = c.get("user");

    if (!currentUser) {
        return c.json({ error: "Not authenticated" }, 401);
    }

    // Only admin and superadmin can delete users
    if (currentUser.role !== "admin" && currentUser.role !== "superadmin") {
        return c.json({ error: "Permission denied" }, 403);
    }

    try {
        const id = Number(c.req.param("id"));

        // Cannot delete self
        if (id === currentUser.sub) {
            return c.json({ error: "Cannot delete yourself" }, 400);
        }

        // Check target user role
        const targetUser = sqlite.query("SELECT role FROM users WHERE id = ?").get(id) as { role: string } | null;

        if (!targetUser) {
            return c.json({ error: "User not found" }, 404);
        }

        // Admin cannot delete superadmin
        if (currentUser.role === "admin" && targetUser.role === "superadmin") {
            return c.json({ error: "Permission denied" }, 403);
        }

        sqlite.prepare("DELETE FROM users WHERE id = ?").run(id);
        return c.json({ status: "deleted" });
    } catch (e) {
        console.error("Delete user error:", e);
        return c.json({ error: String(e) }, 500);
    }
});

export default users;
