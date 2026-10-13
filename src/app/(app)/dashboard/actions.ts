"use server"

import { revalidatePath } from "next/cache"

import { assertEditingAllowed } from "@/lib/auth/edit-policy"
import { createClient } from "@/lib/supabase/server"
import { DASHBOARD_CARDS, type DashboardCard } from "@/lib/dashboard-cards"

/** Saves which dashboard cards this user hides (I02: Owner-configurable). */
export async function saveDashboardCardsAction(formData: FormData): Promise<void> {
  await assertEditingAllowed()
  const shown = new Set(formData.getAll("show").map(String))
  const hidden = DASHBOARD_CARDS.map((c) => c.key).filter((k) => !shown.has(k)) as DashboardCard[]

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: workspace } = await supabase.from("workspaces").select("id").limit(1).maybeSingle()
  if (!user || !workspace) throw new Error("Not signed in.")

  const { error } = await supabase
    .from("dashboard_preferences")
    .upsert({ user_id: user.id, workspace_id: workspace.id, hidden_cards: hidden, updated_at: new Date().toISOString() })
  if (error) throw new Error("Could not save the dashboard settings.")
  revalidatePath("/dashboard")
}
