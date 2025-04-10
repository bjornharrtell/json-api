/**
 * Convert str from kebab-case to camelCase
 */
export function camel(str: string) {
  return str.replace(/[-][a-z\u00E0-\u00F6\u00F8-\u00FE]/g, (match) => match.slice(1).toUpperCase())
}
