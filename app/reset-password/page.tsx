import ResetPasswordClient from "./ResetPasswordClient";

type PageProps = {
  searchParams?: Promise<{
    token?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = (await searchParams) || {};
  const token = params.token || "";

  return <ResetPasswordClient token={token} />;
}