// Allowed duration choices (minutes) for the appointment form dropdown.
//
// This constant lives in a plain module — NOT in `actions.ts` — because every
// export of a `'use server'` file is wrapped as an RPC server-action stub at
// build time, regardless of the original value. Exporting the array from
// `actions.ts` therefore made `APPOINTMENT_DURATIONS` arrive on the client as
// a function, not an array, breaking `.includes()` at runtime.
export const APPOINTMENT_DURATIONS = [15, 30, 45, 60, 90, 120] as const
