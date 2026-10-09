import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { desc, eq } from "drizzle-orm";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { db } from "../../db/index.js";
import { products, storeSettings } from "../../db/schema.js";

const SETTINGS_ID = "main";
// Same passcode the site has always used until the admin sets a new one.
const DEFAULT_PASS = "Akh!2026#Admin";

const SEED = [
  { id: 1, title: "Rose Embroidery Set", price: 1890, discount: 15, cat: "Embroidery", desc: "নরম ফেব্রিক, সূক্ষ্ম এমব্রয়ডারি ও elegant finish.", tone: 1 },
  { id: 2, title: "Classic Sandal Print", price: 1490, discount: 10, cat: "Printed", desc: "সিম্পল প্রিন্টের সঙ্গে আরামদায়ক daily wear.", tone: 2 },
  { id: 3, title: "Lavender Festive", price: 2290, discount: 20, cat: "Festive", desc: "বিশেষ দিনের জন্য রুচিশীল ও premium look.", tone: 3 },
  { id: 4, title: "Olive Premium Set", price: 1990, discount: 0, cat: "Premium", desc: "মার্জিত olive tone ও timeless three-piece style.", tone: 4 },
];

const images = () => getStore("product-images");

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

function hashPass(pass: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pass, salt, 64).toString("hex");
}

function checkPass(pass: string, stored: string | null) {
  if (!stored) return pass === DEFAULT_PASS;
  const [salt, hash] = stored.split(":");
  const a = Buffer.from(hash, "hex");
  const b = scryptSync(pass, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Creates the settings row and the starter products the first time the store is used.
async function getSettingsRow() {
  const [row] = await db.select().from(storeSettings).where(eq(storeSettings.id, SETTINGS_ID));
  if (row) return row;
  await db.insert(storeSettings).values({ id: SETTINGS_ID, data: {} }).onConflictDoNothing();
  await db.insert(products).values(SEED.map((p) => ({ ...p, images: [] }))).onConflictDoNothing();
  const [created] = await db.select().from(storeSettings).where(eq(storeSettings.id, SETTINGS_ID));
  return created;
}

async function isAdmin(req: Request) {
  const pass = req.headers.get("x-admin-pass") || "";
  if (!pass) return false;
  const row = await getSettingsRow();
  return checkPass(pass, row.passHash);
}

// Saves an uploaded data: URL image to Blobs and returns its public URL. Existing URLs pass through.
async function saveImage(value: unknown): Promise<string | null> {
  if (typeof value !== "string" || !value) return null;
  const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) return value.startsWith("/api/images/") ? value : null;
  const key = randomUUID();
  const bytes = Buffer.from(match[2], "base64");
  await images().set(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
    metadata: { contentType: match[1] },
  });
  return "/api/images/" + key;
}

async function deleteImages(urls: string[]) {
  await Promise.all(
    urls.filter((u) => u.startsWith("/api/images/")).map((u) => images().delete(u.slice("/api/images/".length)))
  );
}

async function productFields(body: any) {
  const title = String(body.title || "").trim();
  const price = Math.round(Number(body.price));
  if (!title || !price) return null;
  const list = Array.isArray(body.images) ? body.images.slice(0, 4) : [];
  const saved = (await Promise.all(list.map(saveImage))).filter((x): x is string => !!x);
  return {
    title,
    price,
    discount: Math.min(100, Math.max(0, Math.round(Number(body.discount) || 0))),
    cat: String(body.cat || "Premium"),
    desc: String(body.desc || "").trim(),
    tone: Math.round(Number(body.tone) || 1),
    images: saved,
  };
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path.startsWith("/api/images/") && req.method === "GET") {
    const key = path.slice("/api/images/".length);
    const entry = await images().getWithMetadata(key, { type: "arrayBuffer" });
    if (!entry) return new Response("Not found", { status: 404 });
    return new Response(entry.data, {
      headers: {
        "Content-Type": String(entry.metadata?.contentType || "image/jpeg"),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  if (path === "/api/store" && req.method === "GET") {
    const row = await getSettingsRow();
    const list = await db.select().from(products).orderBy(desc(products.createdAt), desc(products.id));
    return json({
      settings: row.data,
      products: list.map(({ createdAt, ...p }) => p),
    });
  }

  if (path === "/api/admin/login" && req.method === "POST") {
    return (await isAdmin(req)) ? json({ ok: true }) : json({ error: "Wrong passcode" }, 401);
  }

  if (!(await isAdmin(req))) return json({ error: "Unauthorized" }, 401);

  if (path === "/api/settings" && req.method === "PUT") {
    const body = await req.json();
    const row = await getSettingsRow();
    const data = { ...(body.data || {}) };
    delete data.pass;
    if ("heroImage" in data) {
      const heroImage = await saveImage(data.heroImage);
      data.heroImage = heroImage || "";
      const old = String((row.data as any).heroImage || "");
      if (old && old !== data.heroImage) await deleteImages([old]);
    }
    const update: Partial<typeof storeSettings.$inferInsert> = { data, updatedAt: new Date() };
    if (body.newPass) {
      if (String(body.newPass).length < 10) return json({ error: "Passcode too short" }, 400);
      update.passHash = hashPass(String(body.newPass));
    }
    await db.update(storeSettings).set(update).where(eq(storeSettings.id, SETTINGS_ID));
    return json({ settings: data });
  }

  if (path === "/api/products" && req.method === "POST") {
    const fields = await productFields(await req.json());
    if (!fields) return json({ error: "Title and price are required" }, 400);
    const [created] = await db.insert(products).values({ id: Date.now(), ...fields }).returning();
    const { createdAt, ...p } = created;
    return json(p, 201);
  }

  const match = path.match(/^\/api\/products\/(\d+)$/);
  if (match) {
    const id = Number(match[1]);
    const [existing] = await db.select().from(products).where(eq(products.id, id));
    if (!existing) return json({ error: "Not found" }, 404);

    if (req.method === "PUT") {
      const body = await req.json();
      const fields = await productFields(body);
      if (!fields) return json({ error: "Title and price are required" }, 400);
      // Keep the current photos when no new ones were uploaded.
      if (!Array.isArray(body.images)) fields.images = existing.images;
      else await deleteImages(existing.images.filter((u) => !fields.images.includes(u)));
      const [updated] = await db.update(products).set(fields).where(eq(products.id, id)).returning();
      const { createdAt, ...p } = updated;
      return json(p);
    }

    if (req.method === "DELETE") {
      await db.delete(products).where(eq(products.id, id));
      await deleteImages(existing.images);
      return json({ ok: true });
    }
  }

  return json({ error: "Not found" }, 404);
};

export const config: Config = {
  path: ["/api/store", "/api/admin/login", "/api/settings", "/api/products", "/api/products/*", "/api/images/*"],
};
