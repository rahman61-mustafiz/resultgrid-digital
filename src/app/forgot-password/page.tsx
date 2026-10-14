import { ForgotPasswordForm } from "@/app/forgot-password/forgot-password-form"

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { link } = await searchParams
  return <ForgotPasswordForm link={typeof link === "string" ? link : undefined} />
}
