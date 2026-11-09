// Forward everything to the staff Worker (service binding, no public hop).
export default {
  fetch: (request, env) => env.STAFF.fetch(request),
};
