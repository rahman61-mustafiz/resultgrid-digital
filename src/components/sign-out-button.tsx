import { Button } from "@/components/ui/button"

/**
 * A plain form POST to /auth/sign-out (see that route): works in every
 * auth state, on desktop and phone, without client JavaScript.
 */
export function SignOutButton({
  variant = "outline",
  label = "Sign out",
}: {
  variant?: "outline" | "ghost" | "link"
  label?: string
}) {
  return (
    <form action="/auth/sign-out" method="post">
      <Button type="submit" variant={variant} size="sm">
        {label}
      </Button>
    </form>
  )
}
