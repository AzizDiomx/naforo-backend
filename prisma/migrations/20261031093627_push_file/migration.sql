-- AlterTable
ALTER TABLE "tenant_profiles" ADD COLUMN     "nationalIdDocUrl" TEXT,
ADD COLUMN     "nationalIdType" TEXT DEFAULT 'cni';
