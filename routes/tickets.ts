import express from 'express';
import { authMiddleware } from '../middleware/authMiddleware.ts';
import * as ticketController from '../controllers/ticketController.ts';

const router = express.Router();

router.use(authMiddleware);

router.get('/', ticketController.getTickets);
router.get('/assigned-summary', ticketController.getAssignedTicketSummary);
router.post('/', ticketController.createTicket);
router.post('/complete-sprint/:projectId', ticketController.completeSprint); // ← before dynamic /:id

router.get('/:id', ticketController.getTicketById);
router.get('/:id/history', ticketController.getTicketHistory);
router.post('/:id/links', ticketController.linkTickets);
router.post('/:id/watch', ticketController.toggleWatch);
router.put('/:id', ticketController.updateTicket);
router.patch('/:id/status', ticketController.updateTicketStatus);
router.delete('/:id', ticketController.deleteTicket);

export default router;
