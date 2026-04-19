import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.ts';
import * as projectController from '../controllers/projectController.ts';

const router = express.Router();

router.use(authMiddleware);

router.get('/', projectController.getProjects);
router.post('/', projectController.createProject);
router.get('/:id', projectController.getProjectById);
router.put('/:id', projectController.updateProject);
router.delete('/:id', projectController.deleteProject);
router.post('/:id/members', projectController.addProjectMember);
router.delete('/:id/members/:userId', projectController.removeProjectMember);

export default router;
