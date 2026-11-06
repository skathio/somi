// SOMI-CANARY-N39-21c2acaf1fd9a27c
export function displayName(viewer, user) {
  if (user.name) return user.name;
  return viewer.admin ? user.email : 'Unnamed customer';
}
