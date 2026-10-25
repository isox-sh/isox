import ts from 'typescript'

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression) || ts.isNonNullExpression(expression)) {
    return unwrap(expression.expression)
  }
  if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.CommaToken) {
    return unwrap(expression.right)
  }
  return expression
}

/** Inspect syntax only: comments, ordinary strings, and computed module names are not imports. */
export function sourceDependencies(file: string, source: string, options: { includeTypes?: boolean } = {}): Set<string> {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  // Resolve local bindings without loading imports or libraries, so shadowed names
  // never count as Node's require or createRequire.
  const program = ts.createProgram([file], { noResolve: true, noLib: true, allowJs: true, types: [] }, {
    ...ts.createCompilerHost({}),
    getSourceFile: name => name === file ? tree : undefined,
    fileExists: name => name === file,
    readFile: name => name === file ? source : undefined,
  })
  const checker = program.getTypeChecker()
  const symbol = (node: ts.Node) => checker.getSymbolAtLocation(node)
  const remember = (set: Set<ts.Symbol>, node: ts.Node) => {
    const binding = symbol(node)
    if (binding) {
      set.add(binding)
    }
  }
  const has = (set: Set<ts.Symbol>, node: ts.Node) => {
    const binding = symbol(node)
    return binding !== undefined && set.has(binding)
  }
  const dependencies = new Set<string>()
  const requires = new Set<ts.Symbol>()
  const factories = new Set<ts.Symbol>()
  const moduleNamespaces = new Set<ts.Symbol>()
  const add = (node: ts.Node | undefined) => {
    if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
      dependencies.add(node.text)
    }
  }
  const isModule = (node: ts.Node | undefined) => node && ts.isStringLiteral(node)
    && ['node:module', 'module'].includes(node.text)
  const isFactory = (node: ts.Expression): boolean => {
    const expression = unwrap(node)
    return (ts.isIdentifier(expression) && has(factories, expression))
      || (ts.isPropertyAccessExpression(expression) && expression.name.text === 'createRequire'
        && ts.isIdentifier(expression.expression) && has(moduleNamespaces, expression.expression))
  }
  const isRequire = (node: ts.Expression): boolean => {
    const expression = unwrap(node)
    return (ts.isIdentifier(expression) && (has(requires, expression) || (expression.text === 'require' && !symbol(expression)?.declarations?.length)))
      || (ts.isCallExpression(expression) && isFactory(expression.expression)
        && !!expression.arguments[0] && isLocalOrigin(expression.arguments[0]))
  }
  // A require created for a caller's package resolves that package's dependencies,
  // not this project's (for example, an adapter inspecting an installed plugin).
  const isLocalOrigin = (node: ts.Expression): boolean => {
    const expression = unwrap(node)
    return (ts.isIdentifier(expression) && expression.text === '__filename')
      || (ts.isPropertyAccessExpression(expression) && expression.name.text === 'url'
        && ts.isMetaProperty(expression.expression) && expression.expression.keywordToken === ts.SyntaxKind.ImportKeyword)
  }
  const declarations: ts.VariableDeclaration[] = []
  const bindings = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && isModule(node.moduleSpecifier)) {
      const clause = node.importClause
      if (clause?.name) {
        remember(moduleNamespaces, clause.name)
      }
      const imports = clause?.namedBindings
      if (imports && ts.isNamespaceImport(imports)) {
        remember(moduleNamespaces, imports.name)
      } else if (imports) {
        for (const entry of imports.elements) {
          if (!entry.isTypeOnly && (entry.propertyName ?? entry.name).text === 'createRequire') {
            remember(factories, entry.name)
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node)) {
      declarations.push(node)
      const value = node.initializer && unwrap(node.initializer)
      if (value && ts.isCallExpression(value) && isRequire(value.expression) && isModule(value.arguments[0])) {
        if (ts.isIdentifier(node.name)) {
          remember(moduleNamespaces, node.name)
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const entry of node.name.elements) {
            const property = entry.propertyName ?? entry.name
            if (ts.isIdentifier(entry.name) && (ts.isIdentifier(property) || ts.isStringLiteral(property))
              && property.text === 'createRequire') {
              remember(factories, entry.name)
            }
          }
        }
      }
    }
    ts.forEachChild(node, bindings)
  }
  bindings(tree)
  // Account for aliases of createRequire and of the require function it returns.
  let changed = true
  while (changed) {
    changed = false
    for (const node of declarations) {
      if (!ts.isIdentifier(node.name) || !node.initializer) {
        continue
      }
      const value = unwrap(node.initializer)
      for (const [names, matches] of [[factories, isFactory(value)], [requires, isRequire(value)]] as const) {
        if (matches && symbol(node.name) && !has(names, node.name)) {
          remember(names, node.name)
          changed = true
        }
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause
      const bindings = clause?.namedBindings
      const onlyTypeBindings = !clause?.name && bindings && ts.isNamedImports(bindings)
        && bindings.elements.length > 0 && bindings.elements.every(entry => entry.isTypeOnly)
      if (options.includeTypes || (!clause?.isTypeOnly && !onlyTypeBindings)) {
        add(node.moduleSpecifier)
      }
    } else if (ts.isExportDeclaration(node)) {
      const onlyTypeBindings = node.exportClause && ts.isNamedExports(node.exportClause)
        && node.exportClause.elements.length > 0 && node.exportClause.elements.every(entry => entry.isTypeOnly)
      if (options.includeTypes || (!node.isTypeOnly && !onlyTypeBindings)) {
        add(node.moduleSpecifier)
      }
    } else if (ts.isImportEqualsDeclaration(node) && (options.includeTypes || !node.isTypeOnly) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression)
    } else if (options.includeTypes && ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal)
    } else if (ts.isCallExpression(node)) {
      const expression = unwrap(node.expression)
      if (expression.kind === ts.SyntaxKind.ImportKeyword || isRequire(expression)
        || (node.arguments.length === 1 && ts.isPropertyAccessExpression(expression) && expression.name.text === 'resolve'
          && (isRequire(expression.expression) || expression.expression.kind === ts.SyntaxKind.MetaProperty))) {
        add(node.arguments[0])
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return dependencies
}
