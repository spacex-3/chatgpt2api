export type StoredAuthKeyDecisionOptions = {
  withStoredAuthKey?: boolean;
  hasAuthorizationHeader?: boolean;
};

export function shouldReadStoredAuthKey(options: StoredAuthKeyDecisionOptions = {}) {
  return options.withStoredAuthKey !== false && !options.hasAuthorizationHeader;
}
