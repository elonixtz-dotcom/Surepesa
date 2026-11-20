-- Borderless Payments (blueprint §7): corridors, FX quotes, cross-border transfers,
-- partner settlement tracking. Corridors start SUSPENDED until reviewed; unsupported
-- routes are unavailable, never simulated as live.

CREATE TYPE "CorridorStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "FxQuoteStatus" AS ENUM ('OPEN', 'ACCEPTED', 'EXPIRED', 'CANCELLED');
CREATE TYPE "CrossBorderStatus" AS ENUM ('CREATED', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED');
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'RECONCILED', 'FAILED');

CREATE TABLE "payment_corridors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "origin_country" TEXT NOT NULL,
    "destination_country" TEXT NOT NULL,
    "source_currency" TEXT NOT NULL,
    "destination_currency" TEXT NOT NULL,
    "allowed_types" TEXT[] NOT NULL DEFAULT ARRAY['SEND'],
    "provider_name" TEXT NOT NULL,
    "min_amount" BIGINT NOT NULL,
    "max_amount" BIGINT NOT NULL,
    "status" "CorridorStatus" NOT NULL DEFAULT 'SUSPENDED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_corridors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_corridors_route_provider_key" ON "payment_corridors"(
    "origin_country", "destination_country", "source_currency", "destination_currency", "provider_name"
);

CREATE TABLE "fx_quotes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "corridor_id" UUID NOT NULL,
    "source_amount" BIGINT NOT NULL,
    "source_currency" TEXT NOT NULL,
    "destination_amount" BIGINT NOT NULL,
    "destination_currency" TEXT NOT NULL,
    "rate" DECIMAL(24,10) NOT NULL,
    "exchange_rate_id" UUID NOT NULL,
    "fee_amount" BIGINT NOT NULL,
    "provider_name" TEXT NOT NULL,
    "status" "FxQuoteStatus" NOT NULL DEFAULT 'OPEN',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fx_quotes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fx_quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fx_quotes_corridor_id_fkey" FOREIGN KEY ("corridor_id") REFERENCES "payment_corridors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "fx_quotes_exchange_rate_id_fkey" FOREIGN KEY ("exchange_rate_id") REFERENCES "exchange_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "fx_quotes_user_id_created_at_idx" ON "fx_quotes"("user_id", "created_at");

CREATE TABLE "cross_border_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "sender_id" UUID NOT NULL,
    "recipient_id" UUID,
    "recipient_phone" TEXT NOT NULL,
    "recipient_country" TEXT NOT NULL,
    "corridor_id" UUID NOT NULL,
    "quote_id" UUID NOT NULL,
    "status" "CrossBorderStatus" NOT NULL DEFAULT 'CREATED',
    "transaction_id" UUID,
    "idempotency_key" TEXT,
    "failure_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cross_border_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cross_border_transfers_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_border_transfers_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_border_transfers_corridor_id_fkey" FOREIGN KEY ("corridor_id") REFERENCES "payment_corridors"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_border_transfers_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "fx_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cross_border_transfers_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "cross_border_transfers_reference_key" ON "cross_border_transfers"("reference");
CREATE UNIQUE INDEX "cross_border_transfers_quote_id_key" ON "cross_border_transfers"("quote_id");
CREATE UNIQUE INDEX "cross_border_transfers_transaction_id_key" ON "cross_border_transfers"("transaction_id");
CREATE UNIQUE INDEX "cross_border_transfers_sender_id_idempotency_key_key" ON "cross_border_transfers"("sender_id", "idempotency_key");
CREATE INDEX "cross_border_transfers_sender_id_created_at_idx" ON "cross_border_transfers"("sender_id", "created_at");
CREATE INDEX "cross_border_transfers_recipient_id_created_at_idx" ON "cross_border_transfers"("recipient_id", "created_at");

CREATE TABLE "provider_settlements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider_name" TEXT NOT NULL,
    "transfer_id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "value_date" TIMESTAMP(3),
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_settlements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "provider_settlements_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "cross_border_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "provider_settlements_provider_name_reference_key" ON "provider_settlements"("provider_name", "reference");
CREATE INDEX "provider_settlements_transfer_id_idx" ON "provider_settlements"("transfer_id");
