import type { Response } from 'express';
import type { AuthRequest } from '../middleware/authMiddleware.ts';
import { supabaseAdmin } from '../lib/supabaseAdmin.ts';
import { ensureProfileExists } from '../lib/profileHelper.ts';

export const getProjects = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { data: membershipData, error: mError } = await supabaseAdmin
      .from('project_members')
      .select('project_id, role')
      .eq('user_id', req.user.id);

    if (mError) throw mError;

    if (!membershipData || membershipData.length === 0) {
      return res.json([]);
    }

    const projectIds = membershipData.map(m => m.project_id);

    const { data: projectsData, error: pError } = await supabaseAdmin
      .from('projects')
      .select('id, title, description, owner_id, updated_at, created_at, members:project_members(user_id)')
      .in('id', projectIds);

    if (pError) throw pError;

    const projects = projectsData.map(project => {
      const membership = membershipData.find(m => m.project_id === project.id);
      return {
        id: project.id,
        title: project.title,
        description: project.description,
        owner_id: project.owner_id,
        updated_at: project.updated_at,
        created_at: project.created_at,
        member_count: project.members?.length ?? 0,
        userRole: membership?.role
      };
    });

    res.json(projects);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createProject = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { title, description, workflow_statuses } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    // Ensure profile exists to satisfy foreign key constraint
    await ensureProfileExists(req.user);

    // 1. Insert project
    const { data: project, error: pError } = await supabaseAdmin
      .from('projects')
      .insert([{ 
        title, 
        description, 
        owner_id: req.user.id,
        workflow_statuses: workflow_statuses || ["To Do", "In Progress", "Done"]
      }])
      .select('*, members:project_members(role, user:profiles(*))')
      .single();

    if (pError) throw pError;

    // 2. Add owner to project_members
    const { error: mError } = await supabaseAdmin
      .from('project_members')
      .insert([{ project_id: project.id, user_id: req.user.id, role: 'owner' }]);

    if (mError) throw mError;

    res.status(201).json(project);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getProjectById = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  try {
    // Check membership first
    const { data: membership, error: mCheckError } = await supabaseAdmin
      .from('project_members')
      .select('role')
      .eq('project_id', id)
      .eq('user_id', req.user.id)
      .maybeSingle();

    if (mCheckError) throw mCheckError;
    if (!membership) return res.status(403).json({ error: 'Not a member of this project' });

    const { data: project, error: pError } = await supabaseAdmin
      .from('projects')
      .select('*, owner:profiles!owner_id(*), members:project_members(role, user:profiles(*))')
      .eq('id', id)
      .single();

    if (pError) throw pError;

    res.json({ ...project, userRole: membership.role });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const updateProject = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { title, description, workflow_statuses } = req.body;

  if (!title && description === undefined && !workflow_statuses) {
    return res.status(400).json({ error: 'At least one field must be provided' });
  }

  try {
    const updates: Record<string, any> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (workflow_statuses !== undefined) updates.workflow_statuses = workflow_statuses;

    const { data, error } = await supabaseAdmin
      .from('projects')
      .update(updates)
      .eq('id', id)
      .eq('owner_id', req.user.id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(403).json({ error: 'Not authorized or project not found' });
      }
      throw error;
    }
    
    if (!data) return res.status(403).json({ error: 'Not authorized or project not found' });
    
    res.json(data);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteProject = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id } = req.params;
  try {
    // 1. Check if project exists and verify ownership
    const { data: project, error: fError } = await supabaseAdmin
      .from('projects')
      .select('owner_id')
      .eq('id', id)
      .maybeSingle();

    if (fError) throw fError;
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only the project owner can delete this project' });
    }

    // 2. Delete the project
    const { error } = await supabaseAdmin
      .from('projects')
      .delete()
      .eq('id', id);

    if (error) throw error;
    res.json({ message: 'Project deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const addProjectMember = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id: projectId } = req.params;
  const { email, role = 'member' } = req.body;

  if (!email) return res.status(400).json({ error: 'Email is required' });

  const VALID_ROLES = ['admin', 'member', 'viewer'];
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({
      error: `Invalid role. Must be one of: ${VALID_ROLES.join(', ')}`
    });
  }

  try {
    const { data: project, error: pError } = await supabaseAdmin
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle();

    if (pError) throw pError;
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.owner_id !== req.user.id) {
      return res.status(403).json({ error: 'Only project owner can add members' });
    }

    // Look up user by email in profiles table (email column added by trigger)
    const { data: profile, error: prError } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();

    if (prError || !profile) {
      return res.status(404).json({ error: 'No user found with that email address' });
    }

    const { data: member, error: mError } = await supabaseAdmin
      .from('project_members')
      .insert([{ project_id: projectId, user_id: profile.id, role }])
      .select('role, user:profiles(*)')
      .single();

    if (mError) {
      if (mError.code === '23505') {
        return res.status(409).json({ error: 'User is already a member of this project' });
      }
      throw mError;
    }

    res.json(member);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const removeProjectMember = async (req: AuthRequest, res: Response) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  const { id: projectId, userId } = req.params;
  try {
    const { data: project } = await supabaseAdmin.from('projects').select('owner_id').eq('id', projectId).maybeSingle();
    if (!project) return res.status(404).json({ error: 'Project not found' });
    if (project.owner_id !== req.user.id) return res.status(403).json({ error: 'Only owner can remove members' });
    if (userId === project.owner_id) return res.status(400).json({ error: 'Cannot remove the project owner' });

    const { error } = await supabaseAdmin.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId);
    if (error) throw error;
    res.json({ message: 'Member removed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
