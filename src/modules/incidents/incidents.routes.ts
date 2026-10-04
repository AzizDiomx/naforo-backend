import { Router } from 'express';
import * as incidentsController from './incidents.controller';
import { validate } from '@/shared/middlewares/validate.middleware';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';
import { requireTenant } from '@/shared/middlewares/tenant.middleware';
import { uploadMultiple } from '@/shared/middlewares/upload.middleware';
import { auditLog } from '@/shared/middlewares/audit.middleware';
import { CreateIncidentSchema, UpdateIncidentSchema, ResolveIncidentSchema } from './incidents.schema';

const router = Router();

router.use(authenticate);
router.use(requireTenant);

router.get(
  '/', 
  authorize('admin', 'manager', 'owner', 'technician'), 
  incidentsController.getAllIncidents
);

router.get(
  '/stats', 
  authorize('admin', 'manager', 'owner'), 
  incidentsController.getStats
);

router.get(
  '/:id', 
  authorize('admin', 'manager', 'owner', 'technician', 'tenant'), 
  incidentsController.getIncidentById
);

router.post(
  '/', 
  authorize('tenant', 'admin', 'manager', 'owner'), 
  validate(CreateIncidentSchema), 
  auditLog('CREATE_INCIDENT', 'Incident'),
  incidentsController.createIncident
);

router.put(
  '/:id', 
  authorize('admin', 'manager', 'owner', 'technician'), 
  validate(UpdateIncidentSchema), 
  auditLog('UPDATE_INCIDENT', 'Incident'),
  incidentsController.updateIncident
);

router.put(
  '/:id/status', 
  authorize('admin', 'manager', 'owner', 'technician'), 
  auditLog('UPDATE_INCIDENT_STATUS', 'Incident'),
  incidentsController.updateIncidentStatus
);

router.post(
  '/:id/assign', 
  authorize('admin', 'manager', 'owner'), 
  auditLog('ASSIGN_INCIDENT', 'Incident'),
  incidentsController.assignIncident
);

router.post(
  '/:id/resolve', 
  authorize('admin', 'manager', 'technician'), 
  validate(ResolveIncidentSchema), 
  auditLog('RESOLVE_INCIDENT', 'Incident'),
  incidentsController.resolveIncident
);

router.post(
  '/:id/photos', 
  authorize('tenant', 'admin', 'manager'), 
  uploadMultiple('photos', 5), 
  auditLog('UPLOAD_INCIDENT_PHOTOS', 'Incident'),
  incidentsController.uploadPhotos
);

export default router;
