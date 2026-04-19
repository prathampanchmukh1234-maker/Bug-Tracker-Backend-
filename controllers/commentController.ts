import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { ensureProfileExists } from '../lib/profileHelper.ts';
import { createNotification } from '../lib/notificationHelper.ts';

export const getComments = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { ticketId } = req.query;
  if (!ticketId) return res.status(400).json({ error: 'Ticket ID is required' });

  try {
    // 1. Get the ticket's project
    const { data: ticketMeta } = await supabaseAdmin
      .from('tickets').select('project_id').eq('id', ticketId).maybeSingle();
    if (!ticketMeta) return res.status(404).json({ error: 'Ticket not found' });

    // 2. Verify membership
    const { data: membership } = await supabaseAdmin
      .from('project_members').select('role')
      .eq('project_id', ticketMeta.project_id)
      .eq('user_id', req.user.id).maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    // 3. Fetch comments
    const { data, error } = await supabaseAdmin
      .from('comments')
      .select('*, author:profiles!author_id(*)')
      .eq('ticket_id', ticketId)
      .eq('is_system', false)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createComment = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { ticket_id, text } = req.body;
  if (!ticket_id || !text) return res.status(400).json({ error: 'Ticket ID and text are required' });

  try {
    // Ensure profile exists to satisfy foreign key constraint
    await ensureProfileExists(req.user);

    // Fetch the ticket's project for notifications
    const { data: ticketRow } = await supabaseAdmin
      .from('tickets')
      .select('project_id')
      .eq('id', ticket_id)
      .maybeSingle();
    
    const projectId = ticketRow?.project_id;

    // Membership check for RBAC
    if (projectId) {
      const { data: membership } = await supabaseAdmin
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      
      if (!membership) return res.status(403).json({ error: 'Not a member of this project' });
      if (membership.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot comment' });
    }

    const { data, error } = await supabaseAdmin
      .from('comments')
      .insert([{
        ticket_id,
        text,
        author_id: req.user.id
      }])
      .select('*, author:profiles!author_id(*)')
      .single();

    if (error) throw error;

    // Handle Mentions
    const mentionRegex = /@([a-zA-Z0-9._]+)/g;
    const mentions = text.match(mentionRegex);
    
    if (mentions) {
      const usernames = mentions.map((m: string) => m.substring(1));
      
      // Find users by username/name
      const { data: mentionedProfiles } = await supabaseAdmin
        .from('profiles')
        .select('id, name')
        .in('name', usernames); // Assuming name is unique or used as handle

      if (mentionedProfiles) {
        for (const profile of mentionedProfiles) {
          if (profile.id !== req.user.id) {
            await createNotification(
              profile.id,
              'mention',
              `${data.author?.name || 'Someone'} mentioned you in a comment`,
              ticket_id,
              projectId
            );
          }
        }
      }
    }

    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteComment = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  try {
    const { data: comment, error: fError } = await supabaseAdmin
      .from('comments').select('author_id').eq('id', id).maybeSingle();

    if (fError) throw fError;
    if (!comment) return res.status(404).json({ error: 'Comment not found' });
    if (comment.author_id !== req.user.id) {
      return res.status(403).json({ error: 'Not authorized to delete this comment' });
    }

    const { error } = await supabaseAdmin.from('comments').delete().eq('id', id);
    if (error) throw error;
    res.json({ message: 'Comment deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
