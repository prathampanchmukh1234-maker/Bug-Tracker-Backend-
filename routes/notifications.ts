import express from "express";
import * as notificationController from "../controllers/notificationController.ts";
import { authMiddleware } from "../middleware/authMiddleware.ts";

const router = express.Router();

router.use(authMiddleware);

router.get("/", notificationController.getNotifications);
router.put("/mark-all-read", notificationController.markAllAsRead);
router.put("/:id/read", notificationController.markAsRead);

export default router;
