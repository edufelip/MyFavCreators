ALTER TYPE "public"."notification_type" ADD VALUE 'WEEKLY_RECAP';--> statement-breakpoint
ALTER TABLE "boosts" ADD COLUMN "notify_on_dethrone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "boosts" ADD COLUMN "notify_weekly_recap" boolean DEFAULT false NOT NULL;