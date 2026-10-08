import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://cgxwyhaimnjjrevanqqd.supabase.co'
const supabaseAnonKey = 'sb_publishable_hZYEQNksMEgYVe56PGCE3A_H7RIOcxl'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

