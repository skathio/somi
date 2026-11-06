// SOMI-CANARY-N39-21c2acaf1fd9a27c
export const displayName = (viewer, user) => {
  return user.name || (viewer.admin ? user.email : `Customer ${user.id}`);
};
