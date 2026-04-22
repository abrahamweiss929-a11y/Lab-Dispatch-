/**
 * Shared form-state shape for every admin server action.
 *
 * - `error` is a top-level banner (set by action-wide failures such as
 *   storage rejections or slug derivation errors).
 * - `fieldErrors` carries per-field inline errors and is returned
 *   without a redirect so the form can re-render with inputs intact.
 */
export interface AdminFormState {
  error: string | null;
  fieldErrors: Partial<Record<string, string>>;
}

export const INITIAL_ADMIN_FORM_STATE: AdminFormState = {
  error: null,
  fieldErrors: {},
};
