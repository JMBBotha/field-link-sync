export {
  DEVICE_ALERT_RULES,
  HARNESS_NO_LOGIN_TECHS,
  NO_LOGIN_EMAIL_DOMAIN,
  decideAdminCompanyAccess,
  decideLinkLogin,
  duplicateNameBlock,
  expectsDeviceChannel,
  isNoLoginEmail,
  nameKey,
  noLoginEmail,
  normalizePersonName,
  skipDeviceAlert,
  takesLiveOffer,
  validatePhone,
  validateTechnicianName,
} from "../../supabase/functions/_shared/noLoginTechnician.ts";

export type { AccessInput } from "../../supabase/functions/_shared/noLoginTechnician.ts";
