CREATE TABLE "notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"dedupe_key" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_subscription_id_notification_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."notification_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_dedupe_key" ON "notification_deliveries" USING btree ("subscription_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_subscription_idx" ON "notification_deliveries" USING btree ("subscription_id","created_at");