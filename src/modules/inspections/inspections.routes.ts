import { Router } from 'express';
import * as inspectionsController from './inspections.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { uploadSingle } from '@/shared/middlewares/upload.middleware';
import { checkSubscription, requirePlanFeature } from '@/shared/middlewares/subscription.middleware';
import {
  CreateInspectionSchema,
  UpdateInspectionSchema,
  SignInspectionSchema,
} from './inspections.schema';

const router = Router();

router.use(authenticate);
router.use(requireTenant);
router.use(checkSubscription);
router.use(requirePlanFeature('digital_inspections', 'États des lieux numériques'));

// Liste & Recherche
router.get(
  '/',
  authorize('admin', 'manager', 'owner'),
  inspectionsController.getAllInspections
);

// Comparatif Entrée vs Sortie pour un contrat donné
router.get(
  '/compare/:contractId',
  authorize('admin', 'manager', 'owner'),
  inspectionsController.compareInspections
);

// Détail d'un état des lieux
router.get(
  '/:id',
  authorize('admin', 'manager', 'owner', 'tenant'),
  inspectionsController.getInspectionById
);

// Création d'un état des lieux
router.post(
  '/',
  authorize('admin', 'manager', 'owner'),
  validate(CreateInspectionSchema),
  auditLog('CREATE_INSPECTION', 'PropertyInspection'),
  inspectionsController.createInspection
);

// Téléversement d'une photo d'état des lieux
router.post(
  '/upload-photo',
  authorize('admin', 'manager', 'owner'),
  uploadSingle('photo'),
  inspectionsController.uploadPhoto
);

// Mise à jour d'un état des lieux
router.put(
  '/:id',
  authorize('admin', 'manager', 'owner'),
  validate(UpdateInspectionSchema),
  auditLog('UPDATE_INSPECTION', 'PropertyInspection'),
  inspectionsController.updateInspection
);

// Signature électronique (Manager ou Locataire)
router.post(
  '/:id/sign',
  authorize('admin', 'manager', 'owner', 'tenant'),
  validate(SignInspectionSchema),
  auditLog('SIGN_INSPECTION', 'PropertyInspection'),
  inspectionsController.signInspection
);

// Suppression
router.delete(
  '/:id',
  authorize('admin', 'manager'),
  auditLog('DELETE_INSPECTION', 'PropertyInspection'),
  inspectionsController.deleteInspection
);

export default router;
