-- AlterEnum
ALTER TYPE "ApprovalType" ADD VALUE 'TRANSACTION_REFUND';

-- AlterEnum
ALTER TYPE "TransactionType" ADD VALUE 'REFUND';

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "amount" BIGINT;

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "escalated_at" TIMESTAMP(3),
ADD COLUMN     "escalation_reason" TEXT,
ADD COLUMN     "next_rail_check_at" TIMESTAMP(3),
ADD COLUMN     "rail_check_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "rail_status" TEXT,
ADD COLUMN     "refunds_transaction_id" UUID;

-- CreateTable
CREATE TABLE "provider_events" (
    "id" BIGSERIAL NOT NULL,
    "provider_name" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "transaction_id" UUID,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "outcome" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_rules" (
    "id" UUID NOT NULL,
    "transaction_type" "TransactionType" NOT NULL,
    "bps" INTEGER NOT NULL,
    "min_fee" BIGINT NOT NULL,
    "max_fee" BIGINT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fee_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_events_transaction_id_idx" ON "provider_events"("transaction_id");

-- CreateIndex
CREATE UNIQUE INDEX "provider_events_provider_name_event_id_key" ON "provider_events"("provider_name", "event_id");

-- CreateIndex
CREATE INDEX "fee_rules_transaction_type_active_effective_from_idx" ON "fee_rules"("transaction_type", "active", "effective_from");

-- CreateIndex
CREATE INDEX "transactions_status_next_rail_check_at_idx" ON "transactions"("status", "next_rail_check_at");

-- CreateIndex
CREATE INDEX "transactions_refunds_transaction_id_idx" ON "transactions"("refunds_transaction_id");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_refunds_transaction_id_fkey" FOREIGN KEY ("refunds_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_events" ADD CONSTRAINT "provider_events_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

