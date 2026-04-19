import express from 'express';
import type { Response } from 'express';
import { authMiddleware } from '../middleware/authMiddleware.ts';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';

const router = express.Router();

router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('name, avatar_url')
      .eq('id', req.user.id)
      .single();
      
    if (error) return res.status(500).json({ error: error.message });
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const { name, email } = req.body;
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  
  try {
    const { error } = await supabaseAdmin
      .from('profiles')
      .upsert({ id: req.user.id, name, email }, { onConflict: 'id' });
      
    if (error) return res.status(500).json({ error: error.message });
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
