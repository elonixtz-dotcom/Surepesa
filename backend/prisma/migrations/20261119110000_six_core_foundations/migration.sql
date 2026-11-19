-- First six-core implementation foundations.
CREATE TYPE "PushBillDestinationType" AS ENUM ('MERCHANT_QR', 'LIPA_NAMBA', 'AGENT_NUMBER');
CREATE TYPE "PushBillStatus" AS ENUM ('CREATED', 'NOTIFIED', 'CALL_PENDING', 'CALL_CONNECTED', 'AWAITING_PAYER_CONFIRMATION', 'AWAITING_PAYMENT', 'PAYMENT_PENDING', 'PAID', 'DECLINED', 'EXPIRED', 'CANCELLED', 'FAILED');
CREATE TYPE "VoiceCallStatus" AS ENUM ('NOT_REQUESTED', 'QUEUED', 'RINGING', 'CONNECTED', 'NO_ANSWER', 'FAILED', 'COMPLETED');
CREATE TYPE "CircleType" AS ENUM ('FAMILY', 'STUDENT', 'VIKOBA', 'FRIENDS', 'CUSTOM');
CREATE TYPE "CircleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "CircleMemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "CircleMemberStatus" AS ENUM ('INVITED', 'ACTIVE', 'LEFT', 'REMOVED');
CREATE TYPE "CircleContributionStatus" AS ENUM ('SELF_REPORTED', 'PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');
CREATE TYPE "EscrowStatus" AS ENUM ('DRAFT', 'AWAITING_FUNDING', 'FUNDED', 'IN_PROGRESS', 'DELIVERED', 'RELEASED', 'DISPUTED', 'REFUND_PENDING', 'REFUNDED', 'CANCELLED', 'EXPIRED');
CREATE TYPE "EscrowReleasePolicy" AS ENUM ('BUYER_CONFIRMATION', 'MILESTONE', 'ADMIN_RESOLUTION');
CREATE TYPE "EscrowDisputeStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED_BUYER', 'RESOLVED_SELLER', 'CLOSED');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');
ALTER TYPE "WalletKind" ADD VALUE 'ESCROW';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_FUNDING';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_RELEASE';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_REFUND';

CREATE TABLE "pushbill_requests" (
 "id" UUID NOT NULL, "reference" TEXT NOT NULL, "requester_user_id" UUID NOT NULL,
 "payer_user_id" UUID NOT NULL, "destination_type" "PushBillDestinationType" NOT NULL,
 "provider_name" TEXT, "destination_label" TEXT NOT NULL, "destination_ciphertext" TEXT NOT NULL,
 "destination_nonce" TEXT NOT NULL, "destination_auth_tag" TEXT NOT NULL, "destination_last_four" TEXT,
 "amount" BIGINT NOT NULL, "currency_code" TEXT NOT NULL, "share_token_hash" TEXT NOT NULL,
 "status" "PushBillStatus" NOT NULL DEFAULT 'CREATED',
 "voice_call_status" "VoiceCallStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
 "voice_call_provider_reference" TEXT, "expires_at" TIMESTAMP(3) NOT NULL,
 "payer_confirmed_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "pushbill_requests_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "pushbill_requester_fkey" FOREIGN KEY ("requester_user_id") REFERENCES "users"("id"),
 CONSTRAINT "pushbill_payer_fkey" FOREIGN KEY ("payer_user_id") REFERENCES "users"("id"),
 CONSTRAINT "pushbill_amount_check" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "pushbill_requests_reference_key" ON "pushbill_requests"("reference");
CREATE UNIQUE INDEX "pushbill_requests_share_token_hash_key" ON "pushbill_requests"("share_token_hash");
CREATE INDEX "pushbill_requests_requester_created_idx" ON "pushbill_requests"("requester_user_id","created_at");
CREATE INDEX "pushbill_requests_payer_status_expires_idx" ON "pushbill_requests"("payer_user_id","status","expires_at");

CREATE TABLE "circles" (
 "id" UUID NOT NULL, "owner_user_id" UUID NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
 "type" "CircleType" NOT NULL, "status" "CircleStatus" NOT NULL DEFAULT 'ACTIVE',
 "currency_code" TEXT NOT NULL DEFAULT 'TZS', "target_amount" BIGINT, "target_date" DATE,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "circles_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "circles_owner_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id"),
 CONSTRAINT "circles_target_check" CHECK ("target_amount" IS NULL OR "target_amount" > 0)
);
CREATE INDEX "circles_owner_created_idx" ON "circles"("owner_user_id","created_at");
CREATE INDEX "circles_type_status_idx" ON "circles"("type","status");

CREATE TABLE "circle_members" (
 "id" UUID NOT NULL, "circle_id" UUID NOT NULL, "user_id" UUID NOT NULL, "invited_by_user_id" UUID,
 "role" "CircleMemberRole" NOT NULL DEFAULT 'MEMBER', "status" "CircleMemberStatus" NOT NULL DEFAULT 'INVITED',
 "joined_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "circle_members_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "circle_members_circle_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE,
 CONSTRAINT "circle_members_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
 CONSTRAINT "circle_members_inviter_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id")
);
CREATE UNIQUE INDEX "circle_members_circle_user_key" ON "circle_members"("circle_id","user_id");
CREATE INDEX "circle_members_user_status_idx" ON "circle_members"("user_id","status");

CREATE TABLE "circle_contributions" (
 "id" UUID NOT NULL, "circle_id" UUID NOT NULL, "user_id" UUID NOT NULL, "amount" BIGINT NOT NULL,
 "currency_code" TEXT NOT NULL, "contribution_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "status" "CircleContributionStatus" NOT NULL DEFAULT 'SELF_REPORTED', "source_type" TEXT NOT NULL DEFAULT 'MANUAL',
 "external_reference" TEXT, "evidence_storage_key" TEXT, "note" TEXT,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "circle_contributions_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "circle_contributions_circle_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE,
 CONSTRAINT "circle_contributions_user_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id"),
 CONSTRAINT "circle_contributions_amount_check" CHECK ("amount" > 0)
);
CREATE INDEX "circle_contributions_circle_date_idx" ON "circle_contributions"("circle_id","contribution_date");
CREATE INDEX "circle_contributions_user_status_idx" ON "circle_contributions"("user_id","status");

CREATE TABLE "escrow_agreements" (
 "id" UUID NOT NULL, "reference" TEXT NOT NULL, "buyer_user_id" UUID NOT NULL, "seller_user_id" UUID,
 "seller_business_id" UUID, "escrow_wallet_id" UUID NOT NULL, "amount" BIGINT NOT NULL,
 "funded_amount" BIGINT NOT NULL DEFAULT 0, "currency_code" TEXT NOT NULL,
 "status" "EscrowStatus" NOT NULL DEFAULT 'DRAFT',
 "release_policy" "EscrowReleasePolicy" NOT NULL DEFAULT 'BUYER_CONFIRMATION', "terms" TEXT NOT NULL,
 "expires_at" TIMESTAMP(3), "funded_at" TIMESTAMP(3), "delivered_at" TIMESTAMP(3),
 "buyer_accepted_at" TIMESTAMP(3), "released_at" TIMESTAMP(3), "refunded_at" TIMESTAMP(3),
 "funding_transaction_id" UUID, "release_transaction_id" UUID, "refund_transaction_id" UUID,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "escrow_agreements_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "escrow_buyer_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "users"("id"),
 CONSTRAINT "escrow_seller_user_fkey" FOREIGN KEY ("seller_user_id") REFERENCES "users"("id"),
 CONSTRAINT "escrow_seller_business_fkey" FOREIGN KEY ("seller_business_id") REFERENCES "businesses"("id"),
 CONSTRAINT "escrow_wallet_fkey" FOREIGN KEY ("escrow_wallet_id") REFERENCES "wallets"("id"),
 CONSTRAINT "escrow_funding_tx_fkey" FOREIGN KEY ("funding_transaction_id") REFERENCES "transactions"("id"),
 CONSTRAINT "escrow_release_tx_fkey" FOREIGN KEY ("release_transaction_id") REFERENCES "transactions"("id"),
 CONSTRAINT "escrow_refund_tx_fkey" FOREIGN KEY ("refund_transaction_id") REFERENCES "transactions"("id"),
 CONSTRAINT "escrow_amount_check" CHECK ("amount" > 0),
 CONSTRAINT "escrow_seller_check" CHECK ((("seller_user_id" IS NOT NULL)::int + ("seller_business_id" IS NOT NULL)::int) = 1)
);
CREATE UNIQUE INDEX "escrow_agreements_reference_key" ON "escrow_agreements"("reference");
CREATE UNIQUE INDEX "escrow_agreements_wallet_key" ON "escrow_agreements"("escrow_wallet_id");
CREATE INDEX "escrow_agreements_buyer_status_idx" ON "escrow_agreements"("buyer_user_id","status","created_at");

CREATE TABLE "escrow_disputes" (
 "id" UUID NOT NULL, "escrow_id" UUID NOT NULL, "opened_by_user_id" UUID NOT NULL,
 "reason" TEXT NOT NULL, "evidence" JSONB, "status" "EscrowDisputeStatus" NOT NULL DEFAULT 'OPEN',
 "resolution_note" TEXT, "resolved_at" TIMESTAMP(3),
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "escrow_disputes_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "escrow_disputes_escrow_fkey" FOREIGN KEY ("escrow_id") REFERENCES "escrow_agreements"("id") ON DELETE CASCADE,
 CONSTRAINT "escrow_disputes_user_fkey" FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id")
);
CREATE INDEX "escrow_disputes_escrow_status_idx" ON "escrow_disputes"("escrow_id","status");

CREATE TABLE "outbox_events" (
 "id" UUID NOT NULL, "event_type" TEXT NOT NULL, "aggregate_type" TEXT NOT NULL,
 "aggregate_id" TEXT NOT NULL, "idempotency_key" TEXT NOT NULL, "payload" JSONB NOT NULL,
 "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING', "attempts" INTEGER NOT NULL DEFAULT 0,
 "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "processed_at" TIMESTAMP(3),
 "last_error" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "outbox_events_idempotency_key_key" ON "outbox_events"("idempotency_key");
CREATE INDEX "outbox_events_status_available_idx" ON "outbox_events"("status","available_at");
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events"("aggregate_type","aggregate_id");
