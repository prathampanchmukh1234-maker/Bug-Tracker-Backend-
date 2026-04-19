import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.ts';
import * as commentController from '../controllers/commentController.ts';

const router = express.Router();

router.use(authMiddleware);

router.get('/', commentController.getComments);
router.post('/', commentController.createComment);
router.delete('/:id', commentController.deleteComment);

export default router;
