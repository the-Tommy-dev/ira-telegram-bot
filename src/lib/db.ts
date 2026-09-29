import postgres, { type Sql } from "postgres";
import { requireEnv } from "@/lib/env";

declare global {
  var __iraSql: Sql | undefined;
}

export function db(): Sql {
  if (!global.__iraSql) {
    global.__iraSql = postgres(requireEnv("DATABASE_URL"), {
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
  }
  return global.__iraSql;
}

export type DbUser = {
  telegram_user_id: string;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  current_flow: string | null;
  current_stage: string | null;
  active_trial_id: string | null;
  session: Record<string, unknown>;
};

export type DbProduct = {
  product_id: string;
  title: string;
  short_description: string | null;
  format: string | null;
  duration: string | null;
  price: string | null;
  cover: string | null;
  details_url: string | null;
  purchase_url: string | null;
  booking_url: string | null;
  trial_enabled: boolean;
  active: boolean;
  sort_order: number;
};
