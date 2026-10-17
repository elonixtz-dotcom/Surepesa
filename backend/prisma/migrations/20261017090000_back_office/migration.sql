-- CreateEnum
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "SupportCasePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportCaseCategory" AS ENUM ('PAYMENT_ISSUE', 'WRONG_RECIPIENT', 'ACCOUNT_ACCESS', 'KYC', 'FRAUD_REPORT', 'GENERAL');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('TRANSACTION_REVERSAL');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "admin_users" ADD COLUMN     "failed_login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "support_cases" (
    "id" UUID NOT NULL,
    "reference" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "transaction_id" UUID,
    "category" "SupportCaseCategory" NOT NULL,
    "priority" "SupportCasePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "assigned_to_id" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_case_notes" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_case_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" UUID NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "transaction_id" UUID,
    "case_id" UUID,
    "reason" TEXT NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_cases_reference_key" ON "support_cases"("reference");

-- CreateIndex
CREATE INDEX "support_cases_status_priority_created_at_idx" ON "support_cases"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "support_cases_user_id_idx" ON "support_cases"("user_id");

-- CreateIndex
CREATE INDEX "support_cases_assigned_to_id_status_idx" ON "support_cases"("assigned_to_id", "status");

-- CreateIndex
CREATE INDEX "support_case_notes_case_id_created_at_idx" ON "support_case_notes"("case_id", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_status_created_at_idx" ON "approval_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "approval_requests_transaction_id_idx" ON "approval_requests"("transaction_id");

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case_notes" ADD CONSTRAINT "support_case_notes_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_case_notes" ADD CONSTRAINT "support_case_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "support_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

