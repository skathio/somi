const TITLE_LIMIT = 6;

export function saveTitle(profile, text) {
  return { ...profile, title: text.length > TITLE_LIMIT ? text.substring(0, TITLE_LIMIT) : text };
}
