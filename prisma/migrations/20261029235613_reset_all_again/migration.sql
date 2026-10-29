-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "signatureHash" TEXT,
ADD COLUMN     "signatureIp" TEXT,
ADD COLUMN     "signatureOtp" TEXT,
ADD COLUMN     "signatureOtpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "signaturePhone" TEXT,
ADD COLUMN     "signatureStatus" TEXT NOT NULL DEFAULT 'unsigned',
ADD COLUMN     "signatureType" TEXT DEFAULT 'otp_sms',
ADD COLUMN     "signatureUserAgent" TEXT,
ADD COLUMN     "signedPdfUrl" TEXT,
ADD COLUMN     "tenantSignatureUrl" TEXT;

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "actualCost" DECIMAL(15,2),
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "estimatedCost" DECIMAL(15,2),
ADD COLUMN     "expenseRejectionReason" TEXT,
ADD COLUMN     "expenseStatus" TEXT DEFAULT 'none',
ADD COLUMN     "invoiceUrl" TEXT,
ADD COLUMN     "isDeductibleFromCRG" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "quoteUrl" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "accentColor" TEXT DEFAULT '#ffefb3',
ADD COLUMN     "licenseNumber" TEXT,
ADD COLUMN     "primaryColor" TEXT DEFAULT '#013e37',
ADD COLUMN     "rccm" TEXT,
ADD COLUMN     "signatureUrl" TEXT,
ADD COLUMN     "stampUrl" TEXT,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "taxNumber" TEXT,
ADD COLUMN     "website" TEXT,
ADD COLUMN     "whiteLabelEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "properties" ADD COLUMN     "landlordId" TEXT,
ADD COLUMN     "managerId" TEXT;

-- AlterTable
ALTER TABLE "tenant_profiles" ADD COLUMN     "lastScoringDate" TIMESTAMP(3),
ADD COLUMN     "predictedDefaultProbability" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "riskFactors" JSONB DEFAULT '[]',
ADD COLUMN     "riskLevel" TEXT NOT NULL DEFAULT 'low';

-- CreateTable
CREATE TABLE "landlords" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'individual',
    "firstName" TEXT,
    "lastName" TEXT,
    "companyName" TEXT,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT DEFAULT 'Abidjan',
    "idNumber" TEXT,
    "bankName" TEXT,
    "ibanOrRib" TEXT,
    "mobileMoneyNumber" TEXT,
    "managementFeeRate" DECIMAL(5,2) NOT NULL DEFAULT 8.0,
    "feeTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landlords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "management_reports" (
    "id" TEXT NOT NULL,
    "reportNumber" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "landlordId" TEXT NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "grossRentCollected" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "managementFeeRate" DECIMAL(5,2) NOT NULL,
    "managementFees" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "feeTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "feeTaxAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "maintenanceExpenses" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "otherDeductions" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "netPayableToLandlord" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "paymentDate" TIMESTAMP(3),
    "paymentReference" TEXT,
    "pdfUrl" TEXT,
    "itemsSummary" JSONB DEFAULT '[]',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "management_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "management_reports_reportNumber_key" ON "management_reports"("reportNumber");

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "landlords"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "landlords" ADD CONSTRAINT "landlords_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_reports" ADD CONSTRAINT "management_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_reports" ADD CONSTRAINT "management_reports_landlordId_fkey" FOREIGN KEY ("landlordId") REFERENCES "landlords"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "management_reports" ADD CONSTRAINT "management_reports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
