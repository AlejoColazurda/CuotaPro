/**
 * Generate a URL-safe slug from a business name
 * Matches the PostgreSQL generate_unique_slug function logic
 */
export function generateSlug(name: string): string {
  if (!name || typeof name !== 'string') {
    return 'negocio';
  }

  const slug = name
    .toLowerCase()
    .trim()
    // Remove accents/diacritics
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // Remove non-alphanumeric except spaces and hyphens
    .replace(/[^a-z0-9\s-]/g, '')
    // Replace spaces with hyphens
    .replace(/\s+/g, '-')
    // Collapse multiple hyphens
    .replace(/-+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-|-$/g, '')
    // Limit length
    .slice(0, 50);

  // If empty after processing, use fallback
  if (slug === '') {
    return 'negocio';
  }

  return slug;
}

/**
 * Add a numeric suffix to make a slug unique
 */
export function addSlugSuffix(baseSlug: string, suffix: number): string {
  return `${baseSlug}-${suffix}`;
}
