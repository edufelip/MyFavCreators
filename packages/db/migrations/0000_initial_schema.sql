CREATE TYPE "public"."boost_status" AS ENUM('PENDING', 'ACTIVE', 'VOID', 'REVERSED');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('UNCLAIMED', 'PENDING', 'CLAIMED');--> statement-breakpoint
CREATE TYPE "public"."creator_platform" AS ENUM('INSTAGRAM', 'TIKTOK', 'YOUTUBE', 'TWITCH', 'X', 'SPOTIFY', 'SUBSTACK', 'WEBSITE');--> statement-breakpoint
CREATE TYPE "public"."impression_surface" AS ENUM('MARQUEE', 'LEADERBOARD', 'ROTATION', 'CREATOR_PAGE', 'EMBED');--> statement-breakpoint
CREATE TYPE "public"."moderation_status" AS ENUM('PENDING_REVIEW', 'APPROVED', 'REJECTED', 'REMOVED', 'OPTOUT_VERIFICATION_PENDING', 'OPTED_OUT');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('DETHRONE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('CREATED', 'PENDING', 'CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."ranking_period_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."ranking_period_type" AS ENUM('WEEKLY', 'ALL_TIME');--> statement-breakpoint
CREATE TYPE "public"."rejection_reason" AS ENUM('NOT_PUBLIC_OR_PROFESSIONAL', 'MINOR', 'DUPLICATE', 'MALICIOUS_URL', 'IMPERSONATION', 'INVALID_PROFILE', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('OPEN', 'RESOLVED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "boosts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"supporter_name" text,
	"supporter_message" text,
	"anonymous" boolean DEFAULT false NOT NULL,
	"supporter_email" text,
	"fan_identity_key" text,
	"payment_id" uuid NOT NULL,
	"status" "boost_status" DEFAULT 'PENDING' NOT NULL,
	"confirmed_at" timestamp with time zone,
	"rotation_starts_at" timestamp with time zone,
	"rotation_ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform" "creator_platform" NOT NULL,
	"handle" text NOT NULL,
	"url" text NOT NULL,
	"normalized_key" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_ranking_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"ranking_period_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"supporter_count" integer DEFAULT 0 NOT NULL,
	"rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"normalized_key" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"category_id" uuid NOT NULL,
	"claim_status" "claim_status" DEFAULT 'UNCLAIMED' NOT NULL,
	"moderation_status" "moderation_status" DEFAULT 'PENDING_REVIEW' NOT NULL,
	"rejection_reason" "rejection_reason",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"surface" "impression_surface" NOT NULL,
	"session_id" text NOT NULL,
	"hour_bucket" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"creator_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"unsub_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disabled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "outbound_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"creator_link_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"hour_bucket" timestamp with time zone NOT NULL,
	"referrer" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"provider_event_id" text,
	"event_fingerprint" text NOT NULL,
	"from_status" "payment_status",
	"to_status" "payment_status" NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_payment_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'BRL' NOT NULL,
	"status" "payment_status" DEFAULT 'CREATED' NOT NULL,
	"raw_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"refunded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rank_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ranking_period_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"passed_creator_id" uuid,
	"from_rank" integer NOT NULL,
	"to_rank" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ranking_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "ranking_period_type" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "ranking_period_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" "report_status" DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "boosts" ADD CONSTRAINT "boosts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "boosts" ADD CONSTRAINT "boosts_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_links" ADD CONSTRAINT "creator_links_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_ranking_snapshots" ADD CONSTRAINT "creator_ranking_snapshots_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_ranking_snapshots" ADD CONSTRAINT "creator_ranking_snapshots_ranking_period_id_ranking_periods_id_fk" FOREIGN KEY ("ranking_period_id") REFERENCES "public"."ranking_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impressions" ADD CONSTRAINT "impressions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_subscriptions" ADD CONSTRAINT "notification_subscriptions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_clicks" ADD CONSTRAINT "outbound_clicks_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_clicks" ADD CONSTRAINT "outbound_clicks_creator_link_id_creator_links_id_fk" FOREIGN KEY ("creator_link_id") REFERENCES "public"."creator_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_events" ADD CONSTRAINT "rank_events_ranking_period_id_ranking_periods_id_fk" FOREIGN KEY ("ranking_period_id") REFERENCES "public"."ranking_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_events" ADD CONSTRAINT "rank_events_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rank_events" ADD CONSTRAINT "rank_events_passed_creator_id_creators_id_fk" FOREIGN KEY ("passed_creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "boosts_payment_id_key" ON "boosts" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "boosts_creator_id_status_idx" ON "boosts" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "boosts_status_rotation_ends_at_idx" ON "boosts" USING btree ("status","rotation_ends_at");--> statement-breakpoint
CREATE INDEX "boosts_fan_identity_key_idx" ON "boosts" USING btree ("fan_identity_key");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_key" ON "categories" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_links_normalized_key_key" ON "creator_links" USING btree ("normalized_key");--> statement-breakpoint
CREATE INDEX "creator_links_creator_id_idx" ON "creator_links" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_ranking_snapshots_period_creator_key" ON "creator_ranking_snapshots" USING btree ("creator_id","ranking_period_id");--> statement-breakpoint
CREATE INDEX "creator_ranking_snapshots_period_rank_idx" ON "creator_ranking_snapshots" USING btree ("ranking_period_id","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_suppressions_normalized_key_key" ON "creator_suppressions" USING btree ("normalized_key");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_slug_key" ON "creators" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "creators_moderation_status_idx" ON "creators" USING btree ("moderation_status");--> statement-breakpoint
CREATE INDEX "creators_category_id_idx" ON "creators" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "impressions_dedup_key" ON "impressions" USING btree ("creator_id","surface","session_id","hour_bucket");--> statement-breakpoint
CREATE INDEX "impressions_creator_hour_idx" ON "impressions" USING btree ("creator_id","hour_bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_subscriptions_unsub_token_key" ON "notification_subscriptions" USING btree ("unsub_token");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_subscriptions_email_creator_type_key" ON "notification_subscriptions" USING btree ("email","creator_id","type");--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_clicks_dedup_key" ON "outbound_clicks" USING btree ("creator_link_id","session_id","hour_bucket");--> statement-breakpoint
CREATE INDEX "outbound_clicks_creator_hour_idx" ON "outbound_clicks" USING btree ("creator_id","hour_bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_events_fingerprint_key" ON "payment_events" USING btree ("event_fingerprint");--> statement-breakpoint
CREATE INDEX "payment_events_payment_id_idx" ON "payment_events" USING btree ("payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_key" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_status_confirmed_at_idx" ON "payments" USING btree ("status","confirmed_at");--> statement-breakpoint
CREATE INDEX "rank_events_period_created_at_idx" ON "rank_events" USING btree ("ranking_period_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ranking_periods_type_window_key" ON "ranking_periods" USING btree ("type","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "reports_creator_id_idx" ON "reports" USING btree ("creator_id");