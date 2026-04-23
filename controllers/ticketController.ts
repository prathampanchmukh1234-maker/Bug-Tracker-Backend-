import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { ensureProfileExists } from '../lib/profileHelper.ts';
import { createNotification } from '../lib/notificationHelper.ts';

export const getTickets = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { projectId, status, priority, assigneeId, search, backlog, labels } = req.query;

  try {
    const { data: memberships } = await supabaseAdmin
      .from('project_members')
      .select('project_id')
      .eq('user_id', req.user.id);
    
    const allowedIds = memberships?.map(m => m.project_id) ?? [];

    let query = supabaseAdmin
      .from('tickets')
      .select('*, assignee:profiles!assignee_id(*), reporter:profiles!reporter_id(*), project:projects(*), comments:comments(count)')
      .in('project_id', allowedIds);

    if (projectId) {
      if (!allowedIds.includes(projectId as string)) {
        return res.status(403).json({ error: 'Not a member of this project' });
      }
      query = query.eq('project_id', projectId);
    }
    if (status) query = query.eq('status', status);
    if (priority) query = query.eq('priority', priority);
    if (assigneeId) query = query.eq('assignee_id', assigneeId);
    if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);

    if (backlog === 'true') {
      query = query.is('sprint_name', null);
    } else if (backlog === 'false') {
      query = query.not('sprint_name', 'is', null);
    }

    if (labels) {
      const labelArray = (labels as string).split(',');
      query = query.overlaps('labels', labelArray);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getAssignedTicketSummary = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from('project_members')
      .select('project_id')
      .eq('user_id', req.user.id);

    if (membershipError) throw membershipError;

    const allowedIds = memberships?.map(m => m.project_id) ?? [];

    if (allowedIds.length === 0) {
      return res.json([]);
    }

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('id, title, status, priority, project_id, updated_at, project:projects(title)')
      .eq('assignee_id', req.user.id)
      .neq('status', 'Done')
      .in('project_id', allowedIds)
      .order('updated_at', { ascending: false })
      .limit(4);

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createTicket = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { title, description, priority, type, assignee_id, project_id, status, sprint_name, labels, due_date, parent_ticket_id } = req.body;
  if (!title || !project_id) return res.status(400).json({ error: 'Title and Project ID are required' });

  try {
    // Ensure profile exists to satisfy foreign key constraint
    await ensureProfileExists(req.user);

    // Membership check
    const { data: membership } = await supabaseAdmin
      .from('project_members').select('role')
      .eq('project_id', project_id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });
    if (membership.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot create tickets' });

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .insert([{
        title,
        description,
        priority: priority || 'medium',
        type: type || 'bug',
        assignee_id,
        project_id,
        reporter_id: req.user.id,
        status: status || 'To Do',
        sprint_name,
        labels: labels || [],
        due_date,
        parent_ticket_id
      }])
      .select('*, assignee:profiles!assignee_id(*), reporter:profiles!reporter_id(*), project:projects(*)')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTicketById = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  try {
    const { data: ticketMeta } = await supabaseAdmin
      .from('tickets').select('project_id').eq('id', id).maybeSingle();
    if (!ticketMeta) return res.status(404).json({ error: 'Ticket not found' });

    const { data: membership } = await supabaseAdmin
      .from('project_members').select('role')
      .eq('project_id', ticketMeta.project_id)
      .eq('user_id', req.user.id).maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .select('*, assignee:profiles!assignee_id(*), reporter:profiles!reporter_id(*), project:projects(*), parent:tickets!parent_ticket_id(*)')
      .eq('id', id)
      .single();

    if (error) throw error;

    // Fetch subtasks
    const { data: subtasks } = await supabaseAdmin
      .from('tickets')
      .select('*, assignee:profiles!assignee_id(*)')
      .eq('parent_ticket_id', id);

    // Fetch links
    const { data: links } = await supabaseAdmin
      .from('ticket_links')
      .select('*, target:tickets!target_ticket_id(*, assignee:profiles!assignee_id(*))')
      .eq('source_ticket_id', id);

    // Watcher check
    const { count: isWatching } = await supabaseAdmin
      .from('ticket_watchers')
      .select('*', { count: 'exact', head: true })
      .eq('ticket_id', id)
      .eq('user_id', req.user.id);

    res.json({ 
      ...data, 
      userRole: membership.role,
      subtasks: subtasks || [],
      links: links || [],
      isWatching: !!isWatching
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTicket = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { title, description, priority, type, assignee_id, status, sprint_name, labels, due_date, estimate_hours, logged_hours } = req.body;

  const allowedUpdates: Record<string, any> = {};
  if (title !== undefined) allowedUpdates.title = title;
  if (description !== undefined) allowedUpdates.description = description;
  if (priority !== undefined) allowedUpdates.priority = priority;
  if (type !== undefined) allowedUpdates.type = type;
  if (assignee_id !== undefined) allowedUpdates.assignee_id = assignee_id;
  if (status !== undefined) allowedUpdates.status = status;
  if (sprint_name !== undefined) allowedUpdates.sprint_name = sprint_name;
  if (labels !== undefined) allowedUpdates.labels = labels;
  if (due_date !== undefined) allowedUpdates.due_date = due_date;
  if (estimate_hours !== undefined) allowedUpdates.estimate_hours = estimate_hours;
  if (logged_hours !== undefined) allowedUpdates.logged_hours = logged_hours;

  if (Object.keys(allowedUpdates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    // Membership check before update
    const { data: ticketRow } = await supabaseAdmin
      .from('tickets').select('project_id').eq('id', id).maybeSingle();
    if (!ticketRow) return res.status(404).json({ error: 'Ticket not found' });

    const { data: membership } = await supabaseAdmin
      .from('project_members').select('role')
      .eq('project_id', ticketRow.project_id).eq('user_id', req.user.id).maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });
    if (membership.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot edit tickets' });

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .update(allowedUpdates)
      .eq('id', id)
      .select('*, assignee:profiles!assignee_id(*), reporter:profiles!reporter_id(*), project:projects(*)')
      .single();

    if (error) throw error;

    // Notifications
    if (allowedUpdates.assignee_id && allowedUpdates.assignee_id !== req.user.id) {
      await createNotification(
        allowedUpdates.assignee_id,
        'assignment',
        `You have been assigned to: ${data.title}`,
        id,
        data.project_id
      );
    }

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateTicketStatus = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { status } = req.body;

  try {
    // Membership and project workflow check
    const { data: ticketRow } = await supabaseAdmin
      .from('tickets')
      .select('project_id, status')
      .eq('id', id)
      .maybeSingle();
    
    if (!ticketRow) return res.status(404).json({ error: 'Ticket not found' });

    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('workflow_statuses')
      .eq('id', ticketRow.project_id)
      .maybeSingle();

    const validStatuses = project?.workflow_statuses ?? ['To Do', 'In Progress', 'Done'];

    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const { data: membership } = await supabaseAdmin
      .from('project_members')
      .select('role')
      .eq('project_id', ticketRow.project_id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });
    if (membership.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot change ticket status' });

    const { data, error } = await supabaseAdmin
      .from('tickets')
      .update({ status })
      .eq('id', id)
      .select('*, assignee:profiles!assignee_id(*), reporter:profiles!reporter_id(*), project:projects(*)')
      .single();

    if (error) throw error;

    // Notifications and History
    if (ticketRow.status !== status) {
      // History
      await supabaseAdmin.from('comments').insert({
        ticket_id: id,
        author_id: req.user.id,
        text: `changed status from **${ticketRow.status}** to **${status}**`,
        is_system: true
      });

      // Notifications (to reporter/assignee if not the actor)
      const notifyUsers = new Set<string>();
      if (data.reporter_id && data.reporter_id !== req.user.id) notifyUsers.add(data.reporter_id);
      if (data.assignee_id && data.assignee_id !== req.user.id) notifyUsers.add(data.assignee_id);
      
      for (const userId of notifyUsers) {
        await createNotification(
          userId,
          'status_change',
          `Ticket ${data.title} status changed to ${status}`,
          id,
          data.project_id
        );
      }
    }

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteTicket = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  try {
    // Check if reporter or project owner
    const { data: ticket, error: tError } = await supabaseAdmin
      .from('tickets')
      .select('reporter_id, project_id')
      .eq('id', id)
      .single();

    if (tError) throw tError;

    const { data: project, error: pError } = await supabaseAdmin
      .from('projects')
      .select('owner_id')
      .eq('id', ticket.project_id)
      .single();

    if (pError) throw pError;

    if (ticket.reporter_id !== req.user.id && project.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Unauthorized to delete this ticket' });
    }

    const { error } = await supabaseAdmin
      .from('tickets')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Ticket deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTicketHistory = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  
  try {
    // 1. Get the ticket's project
    const { data: ticketMeta } = await supabaseAdmin
      .from('tickets').select('project_id').eq('id', id).maybeSingle();
    if (!ticketMeta) return res.status(404).json({ error: 'Ticket not found' });

    // 2. Verify membership
    const { data: membership } = await supabaseAdmin
      .from('project_members').select('role')
      .eq('project_id', ticketMeta.project_id)
      .eq('user_id', req.user.id).maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Access denied' });

    // 3. Now fetch history
    const { data, error } = await supabaseAdmin
      .from('comments')
      .select('*, author:profiles!author_id(*)')
      .eq('ticket_id', id)
      .eq('is_system', true)
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const linkTickets = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { sourceId, targetId, linkType } = req.body;
  if (!sourceId || !targetId || !linkType) return res.status(400).json({ error: 'Source, target and type required' });

  try {
    // Auth check
    const { data: srcTicket } = await supabaseAdmin
      .from('tickets')
      .select('project_id')
      .eq('id', sourceId)
      .maybeSingle();
    
    if (!srcTicket) return res.status(404).json({ error: 'Source ticket not found' });

    const { data: membership } = await supabaseAdmin
      .from('project_members')
      .select('role')
      .eq('project_id', srcTicket.project_id)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!membership) return res.status(403).json({ error: 'Not authorized' });
    if (membership.role === 'viewer') return res.status(403).json({ error: 'Viewers cannot link tickets' });

    const { data, error } = await supabaseAdmin
      .from('ticket_links')
      .insert([{ source_ticket_id: sourceId, target_ticket_id: targetId, link_type: linkType }])
      .select()
      .single();

    if (error) throw error;

    // Fetch target title for history
    const { data: targetTicket } = await supabaseAdmin
      .from('tickets')
      .select('title')
      .eq('id', targetId)
      .maybeSingle();
    
    const targetLabel = targetTicket?.title ?? `#${targetId.slice(0, 8)}`;

    // Insert history
    await supabaseAdmin.from('comments').insert({
      ticket_id: sourceId,
      author_id: req.user.id,
      text: `linked this ticket to **${targetLabel}** as **${linkType}**`,
      is_system: true
    });

    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const toggleWatch = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;

  try {
    // 1. Verify membership
    const { data: ticketMeta } = await supabaseAdmin
      .from('tickets').select('project_id').eq('id', id).maybeSingle();
    if (!ticketMeta) return res.status(404).json({ error: 'Ticket not found' });

    const { data: membership } = await supabaseAdmin
      .from('project_members').select('role')
      .eq('project_id', ticketMeta.project_id)
      .eq('user_id', req.user.id).maybeSingle();
    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });

    // 2. Toggle watch
    const { data: existing } = await supabaseAdmin
      .from('ticket_watchers')
      .select('id')
      .eq('ticket_id', id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin.from('ticket_watchers').delete().eq('id', existing.id);
      res.json({ watching: false });
    } else {
      await supabaseAdmin.from('ticket_watchers').insert({ ticket_id: id, user_id: req.user.id });
      res.json({ watching: true });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const completeSprint = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { projectId } = req.params;
  const { sprintName } = req.body;

  if (!projectId || !sprintName) return res.status(400).json({ error: 'Project ID and Sprint Name required' });

  try {
    // Membership check simplified
    const { data: membership } = await supabaseAdmin
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', req.user.id)
      .maybeSingle();
    
    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });
    
    const canCompleteSprint = ['owner', 'admin'].includes(membership.role);
    if (!canCompleteSprint) {
      return res.status(403).json({ error: 'Only owners and admins can complete sprints' });
    }

    // Move non-Done tickets to backlog (null sprint_name)
    const { error } = await supabaseAdmin
      .from('tickets')
      .update({ sprint_name: null })
      .eq('project_id', projectId)
      .eq('sprint_name', sprintName)
      .neq('status', 'Done');

    if (error) throw error;
    res.json({ message: 'Sprint completed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
