/**
 * Constants live apart from the `"use server"` module, which may only export
 * async functions.
 */
export type UnsubscribeState = { readonly status: "idle" | "done" | "error" };

export const INITIAL_UNSUBSCRIBE_STATE: UnsubscribeState = { status: "idle" };
