import Link from "next/link"

import { createClient } from "@/lib/supabase/server"
import { ListFilters } from "@/components/list-filters"
import { searchAny, param, pick, searchText, type SearchParams } from "@/lib/list-query"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

const TYPES = ["all", "OWNED_BUSINESS", "EXTERNAL_CLIENT"] as const
const STATUSES = ["active", "archived", "all"] as const
const SORTS = ["name", "newest", "oldest"] as const
const SHOWN = 500

export default async function ClientsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams
  const q = searchText(params)
  const type = pick(param(params, "type"), TYPES, "all")
  const status = pick(param(params, "status"), STATUSES, "active")
  const sort = pick(param(params, "sort"), SORTS, "name")

  const supabase = await createClient()
  let query = supabase.from("client_businesses").select("id, display_name, legal_name, record_type, status, country", { count: "exact" })
  if (q) query = query.or(searchAny(["display_name", "legal_name", "country", "industry"], q))
  if (type !== "all") query = query.eq("record_type", type)
  if (status !== "all") query = query.eq("status", status === "active" ? "ACTIVE" : "ARCHIVED")
  query =
    sort === "name"
      ? query.order("display_name", { ascending: true })
      : query.order("created_at", { ascending: sort === "oldest" })
  const { data: clients, error, count } = await query.limit(SHOWN)

  const { count: total } = await supabase.from("client_businesses").select("id", { count: "exact", head: true })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Clients &amp; businesses</h1>
        <Button asChild>
          <Link href="/clients/new">New client/business</Link>
        </Button>
      </div>

      {total === 0 && !error ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No clients or businesses yet.{" "}
            <Link href="/clients/new" className="underline">
              Create the first one
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <>
          <ListFilters
            action="/clients"
            searchLabel="Name, legal name, country or industry"
            q={q}
            selects={[
              {
                name: "type",
                label: "Type",
                value: type,
                options: [
                  { value: "all", label: "All types" },
                  { value: "OWNED_BUSINESS", label: "Owned business" },
                  { value: "EXTERNAL_CLIENT", label: "External client" },
                ],
              },
              {
                name: "status",
                label: "Status",
                value: status,
                options: [
                  { value: "active", label: "Active" },
                  { value: "archived", label: "Archived" },
                  { value: "all", label: "Active and archived" },
                ],
              },
              {
                name: "sort",
                label: "Sort",
                value: sort,
                options: [
                  { value: "name", label: "Name (A-Z)" },
                  { value: "newest", label: "Newest first" },
                  { value: "oldest", label: "Oldest first" },
                ],
              },
            ]}
            resultCount={error ? undefined : count ?? clients?.length ?? 0}
            shown={clients?.length ?? 0}
          />
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              Could not load clients. Reload the page to try again.
            </p>
          ) : !clients || clients.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No clients match these filters.{" "}
              <Link href="/clients" className="underline">
                Clear the filters
              </Link>
              .
            </p>
          ) : (
            <div className="flex flex-col divide-y rounded-md border" data-testid="client-list">
              {clients.map((client) => (
                <Link
                  key={client.id}
                  href={`/clients/${client.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm hover:bg-muted/50"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{client.display_name}</span>
                    <span className="text-muted-foreground">{client.country}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {client.record_type === "OWNED_BUSINESS" ? "Owned business" : "External client"}
                    </Badge>
                    {client.status === "ARCHIVED" ? <Badge variant="secondary">Archived</Badge> : null}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
