import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getConfig } from "../../config";
import { MockStoreApp } from "../../components/mock-store-app";

export const dynamic = "force-dynamic";

export default async function StorePage() {
  const config = getConfig();
  const host = (await headers()).get("host");
  if (!config.MOCK_STORE_ORIGIN || new URL(config.MOCK_STORE_ORIGIN).origin === new URL(config.APP_ORIGIN).origin || host !== new URL(config.MOCK_STORE_ORIGIN).host) {
    notFound();
  }
  return <MockStoreApp />;
}
