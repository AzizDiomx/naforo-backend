import { Request, Response } from 'express';
import { whatsappService } from './whatsapp.service';
import { sendSuccess, sendPaginated, asyncHandler } from '@/shared/helpers/response';
import { getPaginationParams } from '@/shared/helpers/pagination';

export const remindInvoice = asyncHandler(async (req: Request, res: Response) => {
  const result = await whatsappService.remindInvoice(
    req.params.id,
    req.organizationId!,
    req.user?.userId,
    {
      ...req.body,
      userRole: req.user?.role,
    }
  );
  return sendSuccess(res, result, 'Relance WhatsApp préparée avec succès.');
});

export const bulkRemindInvoices = asyncHandler(async (req: Request, res: Response) => {
  const { invoiceIds, customNote } = req.body || {};
  const result = await whatsappService.bulkRemindInvoices({
    organizationId: req.organizationId!,
    invoiceIds: Array.isArray(invoiceIds) ? invoiceIds : [],
    sentById: req.user?.userId,
    userRole: req.user?.role,
    customNote,
  });
  return sendSuccess(
    res,
    result,
    `${result.sentCount} relance(s) WhatsApp préparée(s) avec succès.`
  );
});

export const sendCustom = asyncHandler(async (req: Request, res: Response) => {
  const { recipientPhone, recipientName, message, templateType, relatedEntity, relatedId } = req.body;
  const result = await whatsappService.sendCustomWhatsApp({
    organizationId: req.organizationId!,
    recipientPhone,
    recipientName,
    message,
    templateType,
    relatedEntity,
    relatedId,
    sentById: req.user?.userId,
  });
  return sendSuccess(res, result, 'Message WhatsApp traité avec succès.');
});

export const getLogs = asyncHandler(async (req: Request, res: Response) => {
  const pagination = getPaginationParams(req);
  const templateType = req.query.templateType as string;
  const status = req.query.status as string;
  const search = req.query.search as string;
  const relatedEntity = req.query.relatedEntity as string;

  const result = await whatsappService.getLogs(req.organizationId!, {
    ...pagination,
    templateType,
    status,
    search,
    relatedEntity,
  });

  return sendPaginated(res, result.data, result.meta, 'Historique des notifications WhatsApp.');
});

export const getStats = asyncHandler(async (req: Request, res: Response) => {
  const stats = await whatsappService.getStats(req.organizationId!);
  return sendSuccess(res, stats, 'Statistiques WhatsApp récupérées.');
});
