import { Request, Response } from 'express';
import { chatService } from './chat.service';
import { sendSuccess, asyncHandler } from '@/shared/helpers/response';
import { BadRequestError } from '@/shared/errors/AppError';

export const chatController = {
  createThread: asyncHandler(async (req: Request, res: Response) => {
    const { tenantProfileId, propertyId } = req.body;
    if (!tenantProfileId) {
      throw new BadRequestError("L'identifiant du profil locataire est requis.");
    }
    const thread = await chatService.getOrCreateLandlordThread(
      req.organizationId!,
      tenantProfileId,
      propertyId
    );
    return sendSuccess(res, thread, 'Conversation initialisée avec succès', 201);
  }),

  getThreads: asyncHandler(async (req: Request, res: Response) => {
    const threads = await chatService.getThreads(req.user!.userId, req.user!.role, req.organizationId);
    return sendSuccess(res, threads, 'Liste des conversations récupérée avec succès');
  }),

  getTenantThread: asyncHandler(async (req: Request, res: Response) => {
    const thread = await chatService.getOrCreateTenantThread(req.user!.userId, req.organizationId);
    return sendSuccess(res, thread, 'Conversation locataire récupérée');
  }),

  getMessages: asyncHandler(async (req: Request, res: Response) => {
    const { threadId } = req.params;
    const messages = await chatService.getMessages(threadId, req.user!.userId, req.user!.role, req.organizationId);
    return sendSuccess(res, messages, 'Historique des messages récupéré avec succès');
  }),

  sendMessage: asyncHandler(async (req: Request, res: Response) => {
    const { threadId } = req.params;
    const { content, attachments } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new BadRequestError('Le contenu du message ne peut pas être vide.');
    }

    const message = await chatService.sendMessage(
      threadId,
      req.user!.userId,
      req.user!.role,
      content.trim(),
      attachments,
      req.organizationId
    );

    return sendSuccess(res, message, 'Message transmis avec succès', 201);
  }),

  updateMessage: asyncHandler(async (req: Request, res: Response) => {
    const { messageId } = req.params;
    const { content } = req.body;

    if (!content || typeof content !== 'string' || !content.trim()) {
      throw new BadRequestError('Le contenu du message ne peut pas être vide.');
    }

    const message = await chatService.updateMessage(messageId, req.user!.userId, content.trim());
    return sendSuccess(res, message, 'Message modifié avec succès');
  }),

  deleteMessage: asyncHandler(async (req: Request, res: Response) => {
    const { messageId } = req.params;
    await chatService.deleteMessage(messageId, req.user!.userId);
    return sendSuccess(res, null, 'Message supprimé avec succès');
  }),
};
