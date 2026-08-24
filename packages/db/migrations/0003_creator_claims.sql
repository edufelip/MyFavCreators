CREATE TABLE "creator_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"email" text,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "creator_claims" ADD CONSTRAINT "creator_claims_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creator_claims_creator_key" ON "creator_claims" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creator_claims_token_key" ON "creator_claims" USING btree ("token_hash");