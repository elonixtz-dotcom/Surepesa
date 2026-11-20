-- Circles ★ (blueprint §8): group goal/contribution tracking.
-- Circles never hold or move money; contributions are records with a verification flag.

CREATE TYPE "CircleType" AS ENUM ('FAMILY', 'STUDENT', 'VIKOBA', 'FRIENDS', 'CUSTOM');
CREATE TYPE "CircleStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "CircleRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');
CREATE TYPE "CircleMemberStatus" AS ENUM ('ACTIVE', 'LEFT', 'REMOVED');
CREATE TYPE "CircleInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');
CREATE TYPE "CircleGoalStatus" AS ENUM ('ACTIVE', 'ACHIEVED', 'CANCELLED');
CREATE TYPE "ContributionFrequency" AS ENUM ('ONCE', 'WEEKLY', 'MONTHLY');
CREATE TYPE "ContributionSource" AS ENUM ('SELF_REPORT', 'PAYMENT_TRANSACTION');
CREATE TYPE "ContributionVerification" AS ENUM ('UNVERIFIED', 'PROVIDER_CONFIRMED');

CREATE TABLE "circles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "reference" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "purpose" TEXT,
    "type" "CircleType" NOT NULL,
    "status" "CircleStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency_code" TEXT NOT NULL DEFAULT 'TZS',
    "target_amount" BIGINT,
    "target_date" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "circles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "circles_reference_key" ON "circles"("reference");
CREATE INDEX "circles_owner_id_created_at_idx" ON "circles"("owner_id", "created_at");
CREATE INDEX "circles_status_idx" ON "circles"("status");

CREATE TABLE "circle_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "circle_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "CircleRole" NOT NULL DEFAULT 'MEMBER',
    "status" "CircleMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "reminders" BOOLEAN NOT NULL DEFAULT true,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMP(3),

    CONSTRAINT "circle_members_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "circle_members_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "circle_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "circle_members_circle_id_user_id_key" ON "circle_members"("circle_id", "user_id");
CREATE INDEX "circle_members_user_id_status_idx" ON "circle_members"("user_id", "status");

CREATE TABLE "circle_invitations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "circle_id" UUID NOT NULL,
    "inviter_id" UUID NOT NULL,
    "invitee_id" UUID,
    "invitee_phone" TEXT,
    "token" TEXT NOT NULL,
    "status" "CircleInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "circle_invitations_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "circle_invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "circle_invitations_invitee_id_fkey" FOREIGN KEY ("invitee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "circle_invitations_token_key" ON "circle_invitations"("token");
CREATE INDEX "circle_invitations_circle_id_status_idx" ON "circle_invitations"("circle_id", "status");
CREATE INDEX "circle_invitations_invitee_id_status_idx" ON "circle_invitations"("invitee_id", "status");

CREATE TABLE "circle_goals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "circle_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "target_amount" BIGINT NOT NULL,
    "due_date" DATE,
    "status" "CircleGoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "expected_per_member" BIGINT,
    "frequency" "ContributionFrequency",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_goals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "circle_goals_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "circle_goals_circle_id_status_idx" ON "circle_goals"("circle_id", "status");

CREATE TABLE "contribution_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "circle_id" UUID NOT NULL,
    "goal_id" UUID,
    "member_id" UUID NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency_code" TEXT NOT NULL,
    "source" "ContributionSource" NOT NULL,
    "verification" "ContributionVerification" NOT NULL,
    "transaction_id" UUID,
    "external_ref" TEXT,
    "note" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contribution_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contribution_records_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "contribution_records_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "circle_goals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contribution_records_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "circle_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "contribution_records_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "contribution_records_transaction_id_key" ON "contribution_records"("transaction_id");
CREATE INDEX "contribution_records_circle_id_recorded_at_idx" ON "contribution_records"("circle_id", "recorded_at");
CREATE INDEX "contribution_records_member_id_recorded_at_idx" ON "contribution_records"("member_id", "recorded_at");

CREATE TABLE "circle_events" (
    "id" BIGSERIAL NOT NULL,
    "circle_id" UUID NOT NULL,
    "actor_type" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "circle_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "circle_events_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "circles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "circle_events_circle_id_id_idx" ON "circle_events"("circle_id", "id");
