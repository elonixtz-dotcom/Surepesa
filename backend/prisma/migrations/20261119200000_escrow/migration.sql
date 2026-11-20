-- Escrow ★ (blueprint §10): protected buyer/seller deals with a dedicated per-deal
-- ESCROW_HOLDING wallet in the central ledger. Only the Escrow service posts
-- ESCROW_HOLD / ESCROW_RELEASE / ESCROW_REFUND lines; ordinary wallet flows cannot
-- reach escrow wallets (they have no userId/businessId and kind = ESCROW_HOLDING).

ALTER TYPE "WalletKind" ADD VALUE 'ESCROW_HOLDING';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_HOLD';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_RELEASE';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_REFUND';
ALTER TYPE "LedgerEntryType" ADD VALUE 'ESCROW_HOLD';
ALTER TYPE "LedgerEntryType" ADD VALUE 'ESCROW_RELEASE';
ALTER TYPE "LedgerEntryType" ADD VALUE 'ESCROW_REFUND';
ALTER TYPE "LedgerEntryType" ADD VALUE 'ESCROW_ADJUSTMENT';

CREATE TYPE "EscrowStatus" AS ENUM (
  'DRAFT', 'AWAITING_COUNTERPARTY', 'TERMS_ACCEPTED', 'AWAITING_FUNDING',
  'FUNDING_PROCESSING', 'FUNDED', 'FULFILMENT_IN_PROGRESS',
  'AWAITING_BUYER_CONFIRMATION', 'RELEASE_PENDING', 'RELEASED',
  'DECLINED', 'EXPIRED', 'CANCELLED', 'FUNDING_FAILED',
  'DISPUTED', 'REFUND_PENDING', 'REFUNDED', 'REVIEW_REQUIRED'
);
CREATE TYPE "EscrowEvidenceType" AS ENUM ('PHOTO', 'DOCUMENT', 'TRACKING', 'NOTE', 'OTHER');
CREATE TYPE "EscrowDisputeStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');
CREATE TYPE "EscrowDisputeOutcome" AS ENUM ('RELEASE_TO_SELLER', 'REFUND_BUYER');
CREATE TYPE "EscrowPayoutKind" AS ENUM ('RELEASE', 'REFUND');
CREATE TYPE "EscrowPayoutStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

CREATE TABLE "escrow_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "status" "EscrowStatus" NOT NULL DEFAULT 'DRAFT',
    "item_description" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'TZS',
    "fee_amount" BIGINT NOT NULL DEFAULT 0,
    "terms_hash" TEXT NOT NULL,
    "funding_deadline" TIMESTAMP(3) NOT NULL,
    "delivery_deadline" TIMESTAMP(3),
    "inspection_days" INTEGER NOT NULL DEFAULT 3,
    "escrow_wallet_id" UUID,
    "funding_transaction_id" UUID,
    "idempotency_key" TEXT,
    "funded_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "released_at" TIMESTAMP(3),
    "refunded_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_cases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escrow_cases_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "escrow_cases_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "escrow_cases_escrow_wallet_id_fkey" FOREIGN KEY ("escrow_wallet_id") REFERENCES "wallets"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "escrow_cases_funding_transaction_id_fkey" FOREIGN KEY ("funding_transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "escrow_cases_reference_key" ON "escrow_cases"("reference");
CREATE UNIQUE INDEX "escrow_cases_escrow_wallet_id_key" ON "escrow_cases"("escrow_wallet_id");
CREATE UNIQUE INDEX "escrow_cases_funding_transaction_id_key" ON "escrow_cases"("funding_transaction_id");
CREATE UNIQUE INDEX "escrow_cases_buyer_id_idempotency_key_key" ON "escrow_cases"("buyer_id", "idempotency_key");
CREATE INDEX "escrow_cases_buyer_id_created_at_idx" ON "escrow_cases"("buyer_id", "created_at");
CREATE INDEX "escrow_cases_seller_id_created_at_idx" ON "escrow_cases"("seller_id", "created_at");
CREATE INDEX "escrow_cases_status_funding_deadline_idx" ON "escrow_cases"("status", "funding_deadline");

CREATE TABLE "escrow_evidence" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "submitted_by" UUID NOT NULL,
    "type" "EscrowEvidenceType" NOT NULL,
    "storage_key" TEXT,
    "checksum" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_evidence_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escrow_evidence_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "escrow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escrow_evidence_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "escrow_evidence_case_id_created_at_idx" ON "escrow_evidence"("case_id", "created_at");

CREATE TABLE "escrow_disputes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "opened_by_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "requested_outcome" "EscrowDisputeOutcome" NOT NULL,
    "status" "EscrowDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" "EscrowDisputeOutcome",
    "resolved_by_id" UUID,
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_disputes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escrow_disputes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "escrow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escrow_disputes_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "escrow_disputes_case_id_status_idx" ON "escrow_disputes"("case_id", "status");
CREATE INDEX "escrow_disputes_status_created_at_idx" ON "escrow_disputes"("status", "created_at");

CREATE TABLE "escrow_payouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "case_id" UUID NOT NULL,
    "kind" "EscrowPayoutKind" NOT NULL,
    "amount" BIGINT NOT NULL,
    "fee_amount" BIGINT NOT NULL DEFAULT 0,
    "destination_user_id" UUID NOT NULL,
    "transaction_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "status" "EscrowPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_payouts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escrow_payouts_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "escrow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "escrow_payouts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "escrow_payouts_case_id_kind_key" ON "escrow_payouts"("case_id", "kind");
CREATE UNIQUE INDEX "escrow_payouts_transaction_id_key" ON "escrow_payouts"("transaction_id");
CREATE INDEX "escrow_payouts_case_id_idx" ON "escrow_payouts"("case_id");

CREATE TABLE "escrow_events" (
    "id" BIGSERIAL NOT NULL,
    "case_id" UUID NOT NULL,
    "from_status" "EscrowStatus",
    "to_status" "EscrowStatus",
    "actor_type" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escrow_events_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "escrow_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "escrow_events_case_id_id_idx" ON "escrow_events"("case_id", "id");

CREATE TABLE "escrow_custody_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "partner_name" TEXT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "account_ref_masked" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_custody_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "escrow_reconciliations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "custody_account_id" UUID NOT NULL,
    "statement_total" BIGINT NOT NULL,
    "internal_held_total" BIGINT NOT NULL,
    "difference" BIGINT NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escrow_reconciliations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "escrow_reconciliations_custody_account_id_fkey" FOREIGN KEY ("custody_account_id") REFERENCES "escrow_custody_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "escrow_reconciliations_custody_account_id_created_at_idx" ON "escrow_reconciliations"("custody_account_id", "created_at");
