-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_user_id" TEXT,
ALTER COLUMN "phone_number" DROP NOT NULL,
ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users"("auth_user_id");

