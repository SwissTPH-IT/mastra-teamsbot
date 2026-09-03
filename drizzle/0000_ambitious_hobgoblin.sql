CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."pending_reviews" (
	"thread_id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"user_id" text NOT NULL,
	"upload_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."receipts" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"file_hash" text NOT NULL,
	"file_reference" text NOT NULL,
	"merchant" text,
	"merchant_address" text,
	"merchant_tax_id" text,
	"receipt_date" date,
	"receipt_time" text,
	"reference_number" text,
	"total_amount" numeric(14, 2),
	"subtotal_amount" numeric(14, 2),
	"discount_amount" numeric(14, 2),
	"vat_amount" numeric(14, 2),
	"vat_rate" numeric(6, 3),
	"currency" char(3),
	"payment_method" text,
	"receipt_type" text,
	"category" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_extraction" jsonb NOT NULL,
	"confidence" numeric(3, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_user_file_hash_key" ON "app"."receipts" USING btree ("user_id","file_hash");--> statement-breakpoint
CREATE INDEX "receipts_user_date_idx" ON "app"."receipts" USING btree ("user_id","receipt_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "receipts_user_created_idx" ON "app"."receipts" USING btree ("user_id","created_at" DESC NULLS LAST);