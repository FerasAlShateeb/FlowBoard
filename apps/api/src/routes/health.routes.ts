/** Health routes. Mounted at `/api` → `GET /api/health`. Deliberately public. */
import { Router } from 'express';
import { getHealth } from '../controllers/health.controller';
import { asyncHandler } from '../utils/async-handler';

export const healthRouter: Router = Router();

healthRouter.get('/health', asyncHandler(getHealth));
