CREATE TABLE "app"."settlements" (
	"id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlements_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "settlements_status_check" CHECK ("status" in ('draft', 'submitted')),
	CONSTRAINT "settlements_submitted_at_check" CHECK (("status" = 'submitted') = ("submitted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD COLUMN "settlement_id" text;--> statement-breakpoint
CREATE INDEX "settlements_user_created_idx" ON "app"."settlements" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "app"."receipts" ADD CONSTRAINT "receipts_settlement_fk" FOREIGN KEY ("settlement_id","user_id") REFERENCES "app"."settlements"("id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipts_user_settlement_idx" ON "app"."receipts" USING btree ("user_id","settlement_id");