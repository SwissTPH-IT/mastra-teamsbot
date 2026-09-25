CREATE TABLE "app"."exchange_rates" (
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"on_date" date NOT NULL,
	"rate" numeric(20, 8) NOT NULL,
	"rate_date" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rates_pkey" PRIMARY KEY("base","quote","on_date"),
	CONSTRAINT "exchange_rates_rate_positive" CHECK ("app"."exchange_rates"."rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "app"."settlements" ADD COLUMN "currency" char(3) DEFAULT 'CHF' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."settlements" ADD CONSTRAINT "settlements_currency_check" CHECK ("app"."settlements"."currency" ~ '^[A-Z]{3}$');