import express from "express";
import net from "net";
import path from "path";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(backendDir, "..");
dotenv.config({ path: path.join(workspaceRoot, ".env") });

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("WARNING: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Backend functionality will be limited.");
}

import projectRoutes from "./routes/projects.ts";
import ticketRoutes from "./routes/tickets.ts";
import commentRoutes from "./routes/comments.ts";
import profileRoutes from "./routes/profile.ts";
import notificationRoutes from "./routes/notifications.ts";
import attachmentRoutes from "./routes/attachments.ts";

async function findAvailablePort(preferredPort: number, host = "0.0.0.0") {
  const maxAttempts = 25;

  for (let offset = 0; offset < maxAttempts; offset += 1) {
    const port = preferredPort + offset;
    const isAvailable = await new Promise<boolean>((resolve) => {
      const tester = net.createServer();

      tester.once("error", () => resolve(false));
      tester.once("listening", () => {
        tester.close(() => resolve(true));
      });

      tester.listen(port, host);
    });

    if (isAvailable) {
      return port;
    }
  }

  throw new Error(`No available port found starting from ${preferredPort}.`);
}

async function startServer() {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";
  const preferredPort = Number.parseInt(process.env.PORT ?? (isProduction ? "3000" : "3001"), 10);
  const host = "0.0.0.0";
  const port = await findAvailablePort(preferredPort, host);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    }),
  );
  app.use(cors());
  app.use(express.json());

  app.use("/api/projects", projectRoutes);
  app.use("/api/tickets", ticketRoutes);
  app.use("/api/comments", commentRoutes);
  app.use("/api/me", profileRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/attachments", attachmentRoutes);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  if (isProduction) {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  if (port !== preferredPort) {
    console.warn(`Port ${preferredPort} is in use, using ${port} instead.`);
  }

  app.listen(port, host, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
