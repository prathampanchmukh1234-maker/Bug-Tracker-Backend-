import express from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/authMiddleware.ts';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';

const router = express.Router();
const ALLOWED_MIME_TYPES = [
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'text/plain',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',       // xlsx
];

const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10 MB max
    },
    fileFilter: (_req, file, cb) => {
        if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type not allowed: ${file.mimetype}`));
        }
    }
});

router.use(authMiddleware);

// List attachments for a ticket
router.get('/', async (req: AuthRequest, res) => {
    const { ticketId } = req.query;
    if (!ticketId) return res.status(400).json({ error: 'Ticket ID is required' });

    try {
        // 1. Get ticket's project
        const { data: ticketMeta } = await supabaseAdmin
            .from('tickets').select('project_id').eq('id', ticketId).maybeSingle();
        if (!ticketMeta) return res.status(404).json({ error: 'Ticket not found' });

        // 2. Verify membership
        const { data: membership } = await supabaseAdmin
            .from('project_members').select('role')
            .eq('project_id', ticketMeta.project_id)
            .eq('user_id', req.user!.id).maybeSingle();
        if (!membership) return res.status(403).json({ error: 'Access denied' });

        // 3. Fetch attachments
        const { data, error } = await supabaseAdmin
            .from('attachments')
            .select('*')
            .eq('ticket_id', ticketId);
        
        if (error) throw error;
        res.json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Upload attachment
router.post('/', upload.single('file'), async (req: AuthRequest, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const { ticketId } = req.body;
    const file = req.file;

    if (!ticketId || !file) return res.status(400).json({ error: 'Ticket ID and file are required' });

    try {
        // 1. Verify membership
        const { data: ticket } = await supabaseAdmin.from('tickets').select('project_id').eq('id', ticketId).maybeSingle();
        if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

        const { data: membership } = await supabaseAdmin
            .from('project_members')
            .select('role')
            .eq('project_id', ticket.project_id)
            .eq('user_id', req.user.id)
            .maybeSingle();
        
        if (!membership) return res.status(403).json({ error: 'Not a member of this project' });
        if (membership.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot upload attachments' });

        // 2. Upload to Supabase Storage
        const filePath = `${ticketId}/${Date.now()}_${file.originalname}`;
        
        // Note: Bucket must exist in Supabase console
        const { error: uploadError } = await supabaseAdmin.storage
            .from('attachments')
            .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true
            });
        
        if (uploadError) {
            // If bucket doesn't exist, we might get an error. 
            // Informing the user via error message is best here.
            throw uploadError;
        }

        // 3. Get Public URL
        const { data: { publicUrl } } = supabaseAdmin.storage
            .from('attachments')
            .getPublicUrl(filePath);

        // 4. Insert DB record
        const { data, error: dbError } = await supabaseAdmin
            .from('attachments')
            .insert([{
                ticket_id: ticketId,
                uploader_id: req.user.id,
                file_name: file.originalname,
                file_url: publicUrl
            }])
            .select()
            .single();
        
        if (dbError) throw dbError;

        res.status(201).json(data);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

router.use((err: any, _req: any, res: any, next: any) => {
    if (err instanceof multer.MulterError || err.message?.startsWith('File type not allowed')) {
        return res.status(400).json({ error: err.message });
    }
    next(err);
});

export default router;
