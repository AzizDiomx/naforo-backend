import { prisma } from '@/config/database';
import { generateReference } from '@/shared/helpers/crypto';

export async function findTenantProfileByUserId(userId: string) {
  return await prisma.tenantProfile.findFirst({
    where: { userId, isActive: true },
    include: { user: true },
  });
}

export async function findActiveContractByTenantId(tenantProfileId: string) {
  return await prisma.contract.findFirst({
    where: { tenantProfileId, status: 'active' },
    include: { property: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findPendingInvoiceByContractId(contractId: string) {
  return await prisma.invoice.findFirst({
    where: { contractId, status: { in: ['pending', 'overdue', 'partial'] } },
    orderBy: { dueDate: 'asc' },
  });
}

export async function findPaymentsByTenantId(tenantProfileId: string) {
  return await prisma.payment.findMany({
    where: { tenantProfileId },
    include: { invoice: true },
    orderBy: { paymentDate: 'desc' },
  });
}

export async function findReceiptsByTenantId(tenantProfileId: string) {
  return await prisma.receipt.findMany({
    where: { tenantProfileId },
    include: { property: true },
    orderBy: { issuedAt: 'desc' },
  });
}

export async function findIncidentsByTenantId(tenantProfileId: string) {
  return await prisma.incident.findMany({
    where: { tenantProfileId },
    include: { property: true },
    orderBy: { createdAt: 'desc' },
  });
}

export async function findDocumentsByEntityId(entityId: string) {
  return await prisma.document.findMany({
    where: { entityId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createTenantPayment(data: {
  organizationId: string;
  contractId: string;
  invoiceId?: string;
  tenantProfileId: string;
  declaredBy: string;
  amount: number;
  paymentMethod: string;
  transactionNumber: string;
  paymentDate: string;
  proofUrl?: string;
  comment?: string;
}) {
  const ref = generateReference('PAY');
  return await prisma.payment.create({
    data: {
      paymentReference: ref,
      organizationId: data.organizationId,
      contractId: data.contractId,
      invoiceId: data.invoiceId || null,
      tenantProfileId: data.tenantProfileId,
      declaredBy: data.declaredBy,
      amount: data.amount,
      paymentMethod: data.paymentMethod,
      transactionNumber: data.transactionNumber,
      paymentDate: new Date(data.paymentDate),
      proofUrl: data.proofUrl || null,
      comment: data.comment || null,
      status: 'pending',
    },
  });
}

export async function createTenantIncident(data: {
  organizationId: string;
  propertyId: string;
  tenantProfileId: string;
  type: string;
  title: string;
  description: string;
  priority?: string;
  photos?: string[];
}) {
  const num = generateReference('INC');
  return await prisma.incident.create({
    data: {
      incidentNumber: num,
      organizationId: data.organizationId,
      propertyId: data.propertyId,
      tenantProfileId: data.tenantProfileId,
      type: data.type,
      title: data.title,
      description: data.description,
      priority: data.priority || 'medium',
      photos: data.photos || [],
      status: 'open',
    },
  });
}

export async function updatePaymentProof(paymentId: string, tenantProfileId: string, proofUrl: string) {
  return await prisma.payment.updateMany({
    where: { id: paymentId, tenantProfileId },
    data: { proofUrl },
  });
}

export async function findNotificationsByUserId(userId: string) {
  return await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function markNotificationRead(id: string, userId: string) {
  return await prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
}
