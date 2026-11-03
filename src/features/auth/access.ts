import type { AppConfig } from "../../config";
import type { GoogleIdentity } from "./google";

export type AccessDecision = { allowed: true; isAdmin: boolean } | { allowed: false; reason: "email_unverified" | "not_allowed" };

/**
 * Decide whether a Google identity may sign in.
 *
 * Domain rules match on the ID token's `hd` (hosted domain) claim, NOT on the
 * email suffix. Anyone can create a personal Google account using an address
 * like `someone@yourcompany.com`; only accounts actually managed by your
 * Google Workspace carry `hd=yourcompany.com`.
 */
export function checkAccess(identity: GoogleIdentity, access: AppConfig["access"]): AccessDecision {
  if (!identity.emailVerified) return { allowed: false, reason: "email_unverified" };

  const email = identity.email.toLowerCase();
  const isAdmin = access.adminEmails.has(email);
  const allowed =
    isAdmin ||
    access.allowAnyone ||
    access.emails.has(email) ||
    (identity.hostedDomain !== null && access.domains.has(identity.hostedDomain));

  return allowed ? { allowed: true, isAdmin } : { allowed: false, reason: "not_allowed" };
}
