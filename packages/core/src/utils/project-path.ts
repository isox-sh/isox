import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Resolve a file lexically within a project before accessing the filesystem. */
export function resolveProjectPath(file: string, root: string) {
  const projectRoot = resolve(root)
  const destination = resolve(projectRoot, file)
  const projectPath = relative(projectRoot, destination)
  if (!projectPath || projectPath === '..' || projectPath.startsWith(`..${sep}`) || isAbsolute(projectPath)) {
    throw new Error(`JSON file must be inside the project: ${file}`)
  }

  return { projectRoot, destination, projectPath }
}
