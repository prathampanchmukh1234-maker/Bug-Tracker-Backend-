import { supabaseAdmin } from './supabaseAdmin.ts';

export async function ensureProfileExists(user: any) {
  if (!user) return;

  try {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      console.error('Error checking profile:', error);
      return;
    }

    if (!profile) {
      console.log(`Creating missing profile for user ${user.id}`);
      const { error: insertError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: user.id,
          email: user.email,
          name: user.user_metadata?.name || user.email?.split('@')[0] || 'User',
          avatar_url: user.user_metadata?.avatar_url || null
        });
      
      if (insertError) {
        console.error('Error creating profile:', insertError);
      }
    }
  } catch (err) {
    console.error('Unexpected error in ensureProfileExists:', err);
  }
}
