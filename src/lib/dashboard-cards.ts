/**
 * The dashboard's optional cards (BUILD_READINESS_QUESTIONNAIRE.md I02:
 * Owner-configurable cards/tables). Must match the CHECK on
 * dashboard_preferences.hidden_cards. The truthfulness warnings are not a
 * card: they always show.
 */
export const DASHBOARD_CARDS = [
  { key: "overview", label: "Overview counts" },
  { key: "money", label: "Money in and out, with comparison" },
  { key: "profit", label: "Profit by project" },
  { key: "targets", label: "Target progress" },
  { key: "leads", label: "Leads" },
  { key: "attention", label: "Needs attention" },
] as const

export type DashboardCard = (typeof DASHBOARD_CARDS)[number]["key"]
