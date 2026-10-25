import ts from 'typescript'

export interface SourceGraph {
  roots: string[]
  options: ts.CompilerOptions
  contents: Map<string, string | undefined>
  files: Map<string, boolean>
  directories: Map<string, boolean>
  sources: string[]
}

/** Follow the compiler's imports, including transitive files outside projectRoot. */
export function watchSources(roots: string[], options: ts.CompilerOptions, previous?: SourceGraph): SourceGraph {
  if (previous && previous.options === options
    && roots.length === previous.roots.length && roots.every((file, index) => file === previous.roots[index])
    && [...previous.contents].every(([file, content]) => ts.sys.readFile(file) === content)
    && [...previous.files].every(([file, exists]) => ts.sys.fileExists(file) === exists)
    && [...previous.directories].every(([directory, exists]) => ts.sys.directoryExists(directory) === exists)) {
    return previous
  }

  const contents = new Map<string, string | undefined>()
  const files = new Map<string, boolean>()
  const directories = new Map<string, boolean>()
  // Resolve the graph only when its inputs change. No typechecking or compiler
  // process is needed, and standard library files cannot affect user imports.
  const compilerOptions = {
    ...options,
    noLib: true
  }
  const host = ts.createCompilerHost(compilerOptions)

  host.readFile = file => {
    const content = ts.sys.readFile(file)

    contents.set(file, content)

    return content
  }

  host.fileExists = file => {
    const exists = ts.sys.fileExists(file)

    files.set(file, exists)

    return exists
  }

  host.directoryExists = directory => {
    const exists = ts.sys.directoryExists(directory)

    directories.set(directory, exists)

    return exists
  }

  host.getSourceFile = (file, languageVersion) => {
    const source = host.readFile(file)

    return source === undefined ? undefined : ts.createSourceFile(file, source, languageVersion, true)
  }

  const program = ts.createProgram(roots, compilerOptions, host)

  return {
    roots,
    options,
    contents,
    files,
    directories,
    sources: program.getSourceFiles().map(file => file.fileName)
  }
}
