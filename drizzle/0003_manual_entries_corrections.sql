ALTER TABLE "app"."receipts" ALTER COLUMN "file_hash" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."receipts" ALTER COLUMN "file_reference" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."receipts" ALTER COLUMN "raw_extraction" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD COLUMN "corrected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD CONSTRAINT "receipts_reason_without_file" CHECK ("app"."receipts"."file_reference" is not null or nullif(btrim("app"."receipts"."reason"), '') is not null);