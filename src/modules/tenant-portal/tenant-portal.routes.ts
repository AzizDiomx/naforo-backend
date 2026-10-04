import { Router } from 'express';
import * as tenantPortalController from './tenant-portal.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { uploadSingle, uploadMultiple } from '@/shared/middlewares/upload.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';

const router = Router();

// Require tenant authentication for all tenant portal routes
router.use(authenticate);
router.use(authorize('tenant', 'admin', 'manager'));

/**
 * @route   GET /api/v1/tenant-portal/me
 * @desc    Get logged-in tenant dashboard overview (Profile, Active Contract, Due Invoice, Score)
 */
router.get('/me', tenantPortalController.getTenantOverview);

/**
 * @route   GET /api/v1/tenant-portal/payments
 * @desc    Get tenant's payments history
 */
router.get('/payments', tenantPortalController.getMyPayments);

/**
 * @route   POST /api/v1/tenant-portal/payments/declare
 * @desc    Declare a rent payment with proof
 */
router.post(
  '/payments/declare',
  uploadSingle('proof'),
  auditLog('TENANT_DECLARE_PAYMENT', 'Payment'),
  tenantPortalController.declarePayment
);

/**
 * @route   POST /api/v1/tenant-portal/payments/:id/proof
 * @desc    Upload or update proof for an existing payment declaration
 */
router.post(
  '/payments/:id/proof',
  uploadSingle('proof'),
  auditLog('TENANT_UPLOAD_PROOF', 'Payment'),
  tenantPortalController.uploadPaymentProof
);

/**
 * @route   GET /api/v1/tenant-portal/notifications
 * @desc    Get tenant's notifications
 */
router.get('/notifications', tenantPortalController.getMyNotifications);

/**
 * @route   PATCH /api/v1/tenant-portal/notifications/:id/read
 * @desc    Mark a tenant notification as read
 */
router.patch('/notifications/:id/read', tenantPortalController.markNotificationRead);

/**
 * @route   GET /api/v1/tenant-portal/receipts
 * @desc    Get tenant's official receipts with QR Code data
 */
router.get('/receipts', tenantPortalController.getMyReceipts);

/**
 * @route   GET /api/v1/tenant-portal/incidents
 * @desc    Get incidents reported by tenant
 */
router.get('/incidents', tenantPortalController.getMyIncidents);

/**
 * @route   POST /api/v1/tenant-portal/incidents
 * @desc    Report a new property incident with photos
 */
router.post(
  '/incidents',
  uploadMultiple('photos', 5),
  auditLog('TENANT_REPORT_INCIDENT', 'Incident'),
  tenantPortalController.reportIncident
);

/**
 * @route   GET /api/v1/tenant-portal/documents
 * @desc    Get tenant's lease documents & move-in inspections
 */
router.get('/documents', tenantPortalController.getMyDocuments);

export default router;
