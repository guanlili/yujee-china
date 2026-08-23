/**
 * Password bounds, shared by the better-auth server config and the forms that
 * have to agree with it. The server rejects anything outside these (with
 * PASSWORD_TOO_SHORT / PASSWORD_TOO_LONG); the inputs mirror them so the user
 * gets a field-level message instead of a generic "could not update your
 * password. The link may have expired." — which would send them off to request
 * a fresh link that fails exactly the same way.
 *
 * The numbers also appear spelled out in the auth copy (resetPasswordSubtitle,
 * resetPasswordTooShort) in all five locales. JSON can't import a constant, so
 * changing MIN_PASSWORD_LENGTH means updating those strings by hand.
 */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
