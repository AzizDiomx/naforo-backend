import { Router } from 'express';
import * as notificationsController from './notifications.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';

const router = Router();

router.use(authenticate);

router.get('/', notificationsController.getUserNotifications);
router.get('/preferences', notificationsController.getPreferences);
router.put('/preferences', notificationsController.updatePreferences);
router.patch('/read-all', notificationsController.markAllAsRead);
router.patch('/:id/read', notificationsController.markAsRead);

export default router;
