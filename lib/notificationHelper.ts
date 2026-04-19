import { supabaseAdmin } from './supabaseAdmin.ts';

export const createNotification = async (userId: string, type: string, message: string, ticketId?: string, projectId?: string) => {
  try {
    const { error } = await supabaseAdmin
      .from('notifications')
      .insert([{
        user_id: userId,
        type,
        message,
        ticket_id: ticketId,
        project_id: projectId,
        is_read: false
      }]);
    
    if (error) console.error('Error creating notification:', error);
  } catch (error) {
    console.error('Notification system failure:', error);
  }
};
