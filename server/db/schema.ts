import { sqliteTable, integer, text, real, blob } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const packages = sqliteTable("packages", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    price: real("price").notNull(),
    category: text("category"),
    description: text("description"),
    isActive: integer("is_active").default(1),
});

export const invoices = sqliteTable("invoices", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    invoiceNo: text("invoice_no"),
    clientName: text("client_name"),
    date: text("date"),
    totalAmount: real("total_amount"),
    invoiceData: text("invoice_data"), // Stores JSON string of full payload
    pdfBlob: blob("pdf_blob", { mode: "buffer" }),
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const appConfig = sqliteTable("app_config", {
    key: text("key").primaryKey(),
    value: text("value"),
});

export const users = sqliteTable("users", {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("employee"), // superadmin, admin, employee
    createdAt: text("created_at").default(sql`CURRENT_TIMESTAMP`),
});

