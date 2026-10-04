import { Router } from 'express';
import { chatController } from './chat.controller';
import { authenticate } from '@/shared/middlewares/auth.middleware';
import { authorize } from '@/shared/middlewares/rbac.middleware';

const router = Router();

router.use(authenticate);

/**
 * @route GET /api/v1/chat/threads
 * List all active chat threads for current user
 */
router.get('/threads', chatController.getThreads);

/**
 * @route POST /api/v1/chat/threads
 * Create or open conversation with a tenant (landlord/manager)
 */
router.post('/threads', authorize('admin', 'manager', 'owner'), chatController.createThread);

/**
 * @route GET /api/v1/chat/tenant-thread
 * Get or create current tenant's main chat thread
 */
router.get('/tenant-thread', authorize('tenant'), chatController.getTenantThread);

/**
 * @route GET /api/v1/chat/threads/:threadId/messages
 * Get message history for a specific thread
 */
router.get('/threads/:threadId/messages', chatController.getMessages);

import { requirePlanFeature } from '@/shared/middlewares/subscription.middleware';

/**
 * @route POST /api/v1/chat/threads/:threadId/messages
 * Send message in a thread (Encrypted chat feature)
 */
router.post('/threads/:threadId/messages', requirePlanFeature('chat_encrypted', 'Tchat Locataire Chiffré AES-256'), chatController.sendMessage);

/**
 * @route PUT /api/v1/chat/messages/:messageId
 * Edit a specific message
 */
router.put('/messages/:messageId', chatController.updateMessage);

/**
 * @route DELETE /api/v1/chat/messages/:messageId
 * Delete a specific message
 */
router.delete('/messages/:messageId', chatController.deleteMessage);

export default router;
