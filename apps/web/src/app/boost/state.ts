/** Boost form state, kept out of the `"use server"` module. */
export type BoostFormState = {
  readonly error: string | null;
};

export const INITIAL_BOOST_FORM_STATE: BoostFormState = { error: null };
