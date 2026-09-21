import { create } from 'zustand'
import { supabase } from '../lib/supabase'

interface AiAdminState {
  isAdmin: boolean
  /** Asks the server whether the signed-in user is an AI admin (ai_my_status). This only decides
   *  whether the nav item/page are shown — every admin RPC re-checks server-side regardless. */
  load: () => Promise<void>
}

export const useAiAdminStore = create<AiAdminState>((set) => ({
  isAdmin: false,
  load: async () => {
    const { data, error } = await supabase.rpc('ai_my_status')
    set({ isAdmin: !error && !!(data as { is_admin: boolean }[] | null)?.[0]?.is_admin })
  }
}))
