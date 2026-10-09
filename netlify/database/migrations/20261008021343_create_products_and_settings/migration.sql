CREATE TABLE "products" (
	"id" bigint PRIMARY KEY,
	"title" text NOT NULL,
	"price" integer NOT NULL,
	"discount" integer DEFAULT 0 NOT NULL,
	"cat" text DEFAULT 'Premium' NOT NULL,
	"desc" text DEFAULT '' NOT NULL,
	"tone" integer DEFAULT 1 NOT NULL,
	"images" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_settings" (
	"id" text PRIMARY KEY,
	"data" jsonb DEFAULT '{}' NOT NULL,
	"pass_hash" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
