-- CreateEnum
CREATE TYPE "VirtualCardStatus" AS ENUM ('REQUESTED', 'ACTIVE', 'FROZEN', 'CLOSED', 'FAILED');

-- AlterEnum
ALTER TYPE "WalletKind" ADD VALUE 'CARD';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'CARD_LOAD';
ALTER TYPE "TransactionType" ADD VALUE 'CARD_UNLOAD';
ALTER TYPE "TransactionType" ADD VALUE 'CARD_PURCHASE';
ALTER TYPE "TransactionType" ADD VALUE 'CARD_REFUND';

-- AlterTable
ALTER TABLE "wallets" ADD COLUMN     "card_id" UUID;

-- CreateTable
CREATE TABLE "virtual_cards" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "issuer_name" TEXT NOT NULL,
    "issuer_card_id" TEXT,
    "status" "VirtualCardStatus" NOT NULL DEFAULT 'REQUESTED',
    "nickname" TEXT NOT NULL,
    "brand" TEXT NOT NULL DEFAULT 'VISA',
    "last4" TEXT,
    "expiry_month" INTEGER,
    "expiry_year" INTEGER,
    "currency_code" TEXT NOT NULL DEFAULT 'TZS',
    "per_transaction_limit" BIGINT,
    "validity_months" INTEGER NOT NULL DEFAULT 24,
    "failure_reason" TEXT,
    "frozen_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "virtual_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "card_events" (
    "id" BIGSERIAL NOT NULL,
    "issuer_name" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "card_id" UUID,
    "kind" TEXT NOT NULL,
    "auth_id" TEXT,
    "amount" BIGINT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "merchant_name" TEXT,
    "transaction_id" UUID,
    "decision" TEXT,
    "decline_reason" TEXT,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "card_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "virtual_cards_user_id_status_idx" ON "virtual_cards"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "virtual_cards_issuer_name_issuer_card_id_key" ON "virtual_cards"("issuer_name", "issuer_card_id");

-- CreateIndex
CREATE INDEX "card_events_card_id_received_at_idx" ON "card_events"("card_id", "received_at");

-- CreateIndex
CREATE INDEX "card_events_issuer_name_auth_id_idx" ON "card_events"("issuer_name", "auth_id");

-- CreateIndex
CREATE UNIQUE INDEX "card_events_issuer_name_event_id_key" ON "card_events"("issuer_name", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "wallets_card_id_key" ON "wallets"("card_id");

-- AddForeignKey
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "virtual_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "virtual_cards" ADD CONSTRAINT "virtual_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_events" ADD CONSTRAINT "card_events_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "virtual_cards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

