import { pgTable, bigint, integer, text, jsonb, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
  id: bigint({ mode: "number" }).primaryKey(),
  title: text().notNull(),
  price: integer().notNull(),
  discount: integer().notNull().default(0),
  cat: text().notNull().default("Premium"),
  desc: text().notNull().default(""),
  tone: integer().notNull().default(1),
  images: jsonb().$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const storeSettings = pgTable("store_settings", {
  id: text().primaryKey(),
  data: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  passHash: text("pass_hash"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
