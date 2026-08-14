import { insertReturningId, one } from "../db/runtime";

if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  console.warn("No DATABASE_URL/SUPABASE_DB_URL found; using the local SQLite driver.");
}

const seedUsers = [
  { key: "SEED_SUPERADMIN_PASSWORD", email: "dev@orbit.com", name: "Developer", role: "superadmin" },
  { key: "SEED_ADMIN_PASSWORD", email: "admin@orbit.com", name: "Admin", role: "admin" },
  { key: "SEED_EMPLOYEE_PASSWORD", email: "staff@orbit.com", name: "Staff", role: "employee" },
] as const;

for (const seed of seedUsers) {
  const password = process.env[seed.key];
  if (!password || password.length < 12) {
    throw new Error(`${seed.key} must be set and at least 12 characters long.`);
  }

  const existing = await one<{ id: number }>("SELECT id FROM users WHERE email = ?", [seed.email]);
  if (existing) {
    console.log(`Seed user already exists: ${seed.email}`);
    continue;
  }

  const passwordHash = await Bun.password.hash(password, { algorithm: "bcrypt", cost: 10 });
  await insertReturningId(
    "INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, ?)",
    [seed.email, seed.name, passwordHash, seed.role],
  );
  console.log(`Created seed user: ${seed.email}`);
}

console.log("User seed complete. Password values were not printed.");
