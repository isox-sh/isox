/** Recognize Nx's local project schema and its documented schema identifier. */
export function isNxProjectSchema(schema: unknown): boolean {
  if (typeof schema !== 'string') {
    return false
  }

  const normalized = schema.replaceAll('\\', '/')
  if (/^https?:\/\//.test(normalized)) {
    if (!URL.canParse(normalized)) {
      return false
    }

    const url = new URL(normalized)
    return (url.hostname === 'nx.dev'
      && ['/reference/project-configuration', '/docs/reference/project-configuration'].includes(url.pathname.replace(/\/$/, '')))
      || (url.hostname === 'raw.githubusercontent.com'
        && /^\/nrwl\/nx\/[^/]+\/packages\/nx\/schemas\/project-schema\.json$/.test(url.pathname))
  }

  const path = normalized.split(/[?#]/)[0]
  return /(?:^|\/)(?:nx|@nrwl\/workspace)\/schemas\/project-schema\.json$/.test(path)
}

/** Rename Nx fields without mutating the source object or its additional metadata. */
export function migrateNxProject(
  project: Record<string, unknown>,
  file: string,
  isoxSchema: string,
): Record<string, unknown> {
  const migrated: Record<string, unknown> = { ...project, $schema: isoxSchema }
  if (Object.hasOwn(project, 'implicitDependencies')) {
    if (Object.hasOwn(project, 'dependencies')) {
      throw new Error(`Invalid project configuration in ${file}: Nx schema defines both implicitDependencies and dependencies. Keep one field before migrating.`)
    }
    migrated.dependencies = project.implicitDependencies
    delete migrated.implicitDependencies
  }

  return migrated
}
