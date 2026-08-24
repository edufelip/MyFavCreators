CREATE TYPE "public"."verification_purpose" AS ENUM('OPTOUT', 'CLAIM');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('PENDING', 'VERIFIED', 'EXPIRED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "creator_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"purpose" "verification_purpose" NOT NULL,
	"code" text NOT NULL,
	"status" "verification_status" DEFAULT 'PENDING' NOT NULL,
	"contact_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"verified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "creator_verifications" ADD CONSTRAINT "creator_verifications_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_verifications_code_key" ON "creator_verifications" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_verifications_open_key" ON "creator_verifications" USING btree ("creator_id","purpose") WHERE status = 'PENDING';--> statement-breakpoint
CREATE INDEX "creator_verifications_creator_idx" ON "creator_verifications" USING btree ("creator_id","purpose");