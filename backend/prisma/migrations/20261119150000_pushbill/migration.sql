-- CreateEnum
CREATE TYPE "PushBillState" AS ENUM ('CREATED', 'DESTINATION_VERIFIED', 'PAYER_SELECTED', 'PAYER_NOTIFIED', 'CALL_REQUESTED', 'CALLING', 'CALL_CONNECTED', 'BOTH_PARTIES_CONFIRMED', 'AWAITING_PAYER_AUTH', 'PAYMENT_PROCESSING', 'PAID', 'DECLINED', 'NO_ANSWER', 'CALL_FAILED', 'MISMATCH', 'EXPIRED', 'CANCELLED', 'PAYMENT_FAILED', 'PAYMENT_UNKNOWN', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "PushBillDestinationKind" AS ENUM ('QR_CODE', 'MERCHANT_CODE', 'AGENT_NUMBER');

-- CreateEnum
CREATE TYPE "PushBillRole" AS ENUM ('REQUESTER', 'PAYER');

-- CreateEnum
CREATE TYPE "PushBillConfirmationMethod" AS ENUM ('IN_APP', 'USSD');

-- CreateEnum
CREATE TYPE "PushBillConfirmationResult" AS ENUM ('CONFIRMED', 'REJECTED', 'MISMATCH');

-- CreateEnum
CREATE TYPE "VoiceCallStatus" AS ENUM ('REQUESTED', 'RINGING', 'CONNECTED', 'COMPLETED', 'NO_ANSWER', 'BUSY', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "pushbill_sessions" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "requester_id" UUID NOT NULL,
    "payer_id" UUID,
    "state" "PushBillState" NOT NULL DEFAULT 'CREATED',
    "destination_kind" "PushBillDestinationKind" NOT NULL,
    "destination_input" TEXT NOT NULL,
    "destination_label" TEXT,
    "business_id" UUID,
    "qr_code_id" UUID,
    "amount" BIGINT NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'TZS',
    "note" TEXT,
    "terms_hash" TEXT,
    "idempotency_key" TEXT,
    "payment_transaction_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pushbill_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pushbill_confirmations" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "PushBillRole" NOT NULL,
    "method" "PushBillConfirmationMethod" NOT NULL,
    "details_hash" TEXT NOT NULL,
    "result" "PushBillConfirmationResult" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pushbill_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_call_attempts" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_call_id" TEXT,
    "requester_leg_id" TEXT,
    "payer_leg_id" TEXT,
    "status" "VoiceCallStatus" NOT NULL DEFAULT 'REQUESTED',
    "failure_code" TEXT,
    "last_event_id" TEXT,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "connected_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "voice_call_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pushbill_events" (
    "id" BIGSERIAL NOT NULL,
    "session_id" UUID NOT NULL,
    "from_state" "PushBillState",
    "to_state" "PushBillState" NOT NULL,
    "actor_type" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actor_id" TEXT,
    "note" TEXT,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pushbill_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pushbill_sessions_reference_key" ON "pushbill_sessions"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "pushbill_sessions_payment_transaction_id_key" ON "pushbill_sessions"("payment_transaction_id");

-- CreateIndex
CREATE INDEX "pushbill_sessions_requester_id_created_at_idx" ON "pushbill_sessions"("requester_id", "created_at");

-- CreateIndex
CREATE INDEX "pushbill_sessions_payer_id_created_at_idx" ON "pushbill_sessions"("payer_id", "created_at");

-- CreateIndex
CREATE INDEX "pushbill_sessions_state_expires_at_idx" ON "pushbill_sessions"("state", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "pushbill_sessions_requester_id_idempotency_key_key" ON "pushbill_sessions"("requester_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "pushbill_confirmations_session_id_created_at_idx" ON "pushbill_confirmations"("session_id", "created_at");

-- CreateIndex
CREATE INDEX "voice_call_attempts_session_id_requested_at_idx" ON "voice_call_attempts"("session_id", "requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "voice_call_attempts_provider_provider_call_id_key" ON "voice_call_attempts"("provider", "provider_call_id");

-- CreateIndex
CREATE INDEX "pushbill_events_session_id_id_idx" ON "pushbill_events"("session_id", "id");

-- AddForeignKey
ALTER TABLE "pushbill_sessions" ADD CONSTRAINT "pushbill_sessions_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushbill_sessions" ADD CONSTRAINT "pushbill_sessions_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushbill_sessions" ADD CONSTRAINT "pushbill_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushbill_sessions" ADD CONSTRAINT "pushbill_sessions_qr_code_id_fkey" FOREIGN KEY ("qr_code_id") REFERENCES "qr_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushbill_sessions" ADD CONSTRAINT "pushbill_sessions_payment_transaction_id_fkey" FOREIGN KEY ("payment_transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushbill_confirmations" ADD CONSTRAINT "pushbill_confirmations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pushbill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushbill_confirmations" ADD CONSTRAINT "pushbill_confirmations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_call_attempts" ADD CONSTRAINT "voice_call_attempts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pushbill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pushbill_events" ADD CONSTRAINT "pushbill_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "pushbill_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

