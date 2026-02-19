import { Database } from "bun:sqlite";

const db = new Database("db/sqlite.db");
try {
    const users = db.query("SELECT id, email, role FROM users").all();
    console.log("Users:", users);
} catch (e) {
    console.error("Error querying users:", e);
}
