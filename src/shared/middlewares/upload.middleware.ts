import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { env } from '@/config/env';
import { BadRequestError } from '../errors/AppError';

// Ensure upload directory exists on boot
const uploadDir = path.join(process.cwd(), env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  // Create folders for sub-types
  fs.mkdirSync(path.join(uploadDir, 'invoices'), { recursive: true });
  fs.mkdirSync(path.join(uploadDir, 'receipts'), { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => {
    callback(null, uploadDir);
  },
  filename: (req, file, callback) => {
    // Generate unique name keeping original extension
    const ext = path.extname(file.originalname);
    const filename = `${uuidv4()}${ext}`;
    callback(null, filename);
  },
});

const fileFilter = (req: any, file: Express.Multer.File, callback: multer.FileFilterCallback) => {
  const allowedMimeTypes = env.UPLOAD_ALLOWED_TYPES.split(',');
  
  if (allowedMimeTypes.includes(file.mimetype)) {
    callback(null, true);
  } else {
    callback(new BadRequestError('Type de fichier non autorisé. Formats acceptés: JPEG, PNG, WEBP, PDF.'));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: env.UPLOAD_MAX_SIZE, // e.g. 10MB
  },
});

/**
 * Verify Magic Bytes (Binary Header Signatures) of uploaded files
 */
export function verifyMagicBytes(req: any, res: any, next: any) {
  const file = req.file;
  if (!file) return next();

  try {
    const filePath = file.path;
    const buffer = Buffer.alloc(12);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, 12, 0);
    fs.closeSync(fd);

    let isValid = false;

    // Check PDF Magic Bytes: %PDF- (0x25 0x50 0x44 0x46 0x2D)
    if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) {
      isValid = true;
    }
    // Check PNG Magic Bytes: 0x89 0x50 0x4E 0x47
    else if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      isValid = true;
    }
    // Check JPEG Magic Bytes: 0xFF 0xD8 0xFF
    else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      isValid = true;
    }
    // Check WEBP Magic Bytes: RIFF...WEBP
    else if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
             buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
      isValid = true;
    }

    if (!isValid) {
      // Delete malicious or corrupted file immediately
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      return next(new BadRequestError("Signature binaire du fichier invalide (falsification ou format binaire non reconnu)."));
    }

    next();
  } catch (error) {
    if (file?.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    next(new BadRequestError("Erreur lors de la vérification de l'intégrité binaire du fichier."));
  }
}

/**
 * Helper to upload a single file with magic bytes validation.
 * Returns a single Express middleware (no spread needed in routes).
 */
export const uploadSingle = (fieldName: string) =>
  (req: any, res: any, next: any) => {
    upload.single(fieldName)(req, res, (err: any) => {
      if (err) return next(err);
      verifyMagicBytes(req, res, next);
    });
  };

/**
 * Helper to upload multiple files with magic bytes validation.
 * Returns a single Express middleware (no spread needed in routes).
 */
export const uploadMultiple = (fieldName: string, maxCount = 10) =>
  (req: any, res: any, next: any) => {
    upload.array(fieldName, maxCount)(req, res, (err: any) => {
      if (err) return next(err);
      // For multi-upload, check first file only (representative check)
      verifyMagicBytes(req, res, next);
    });
  };
