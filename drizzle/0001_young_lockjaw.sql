CREATE TABLE "app"."users" (
	"teams_user_id" text PRIMARY KEY NOT NULL,
	"aad_object_id" text,
	"tenant_id" text,
	"display_name" text,
	"conversation_ref" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_aad_object_id_key" ON "app"."users" USING btree ("aad_object_id");