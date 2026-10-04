import { Router } from 'express';
import { locationsController } from './locations.controller';

const router = Router();

// Routes publiques / accessibles aux utilisateurs connectés pour remplir leurs formulaires
router.get('/countries', locationsController.getCountries);
router.get('/cities', locationsController.getCities);
router.get('/grouped', locationsController.getAllGrouped);

export default router;
