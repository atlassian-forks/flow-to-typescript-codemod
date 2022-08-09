import traverse, { NodePath } from "@babel/traverse";
import * as t from "@babel/types";
import { NodeWithComments, updateComments } from "./comments";
import { TransformerInput } from "./transformer";

const importsToExclude = new Set([
  "@atlassian/jira-flow-type",
  "@atlassian/jira-flow-type/src",
]);

const flowExclusiveReactImports = new Set([
  "AbstractComponent",
  "ChildrenArray",
  "Config",
  "Element",
  "ElementConfig",
  "Node",
]);

const shouldRemoveSpecifier = (
  specifier:
    | t.ImportDefaultSpecifier
    | t.ImportSpecifier
    | t.ImportNamespaceSpecifier
) =>
  t.isImportSpecifier(specifier) &&
  t.isIdentifier(specifier.imported) &&
  flowExclusiveReactImports.has(specifier.imported.name);

/**
 * If any of the transforms used a utility type, we need to import them
 * @param state
 * @param file
 */
export function addImports({ state, file }: TransformerInput) {
  let reactImportNode: t.ImportDeclaration | undefined;
  let reactImportPath: NodePath<t.ImportDeclaration> | undefined;

  traverse(file, {
    ImportDeclaration(path) {
      // Remove imports that are in the exclusion list
      if (
        path.node.source.type === "StringLiteral" &&
        importsToExclude.has(path.node.source.value)
      ) {
        path.remove();
      } else if (path.node.source.value === "react") {
        reactImportNode = path.node;
        reactImportPath = path;

        // Remove Flow-exclusive React imports
        reactImportNode.specifiers = reactImportNode.specifiers.filter(
          (specifier) => !shouldRemoveSpecifier(specifier)
        );
      }
    },

    Program: {
      enter(programPath) {
        programPath.traverse({
          enter(path) {
            updateComments(path as NodePath<NodeWithComments>);
          },
        });
      },

      exit(path) {
        // No need for further imports
        if (state.reactImports.size > 0) {
          // There is no existing React import. Prepend it to the program.
          if (reactImportNode === undefined) {
            reactImportNode = t.importDeclaration([], t.stringLiteral("react"));
            path.node.body.unshift(reactImportNode);
          }

          const isNameAlreadyImported = (name: string) =>
            reactImportNode !== undefined &&
            reactImportNode.specifiers.some(
              (specifier) =>
                t.isImportSpecifier(specifier) &&
                t.isIdentifier(specifier.imported) &&
                specifier.imported.name === name
            );

          // Go through every necessary import and append a specifier
          for (const reactName of Array.from(state.reactImports)) {
            if (!isNameAlreadyImported(reactName)) {
              const specifier = t.importSpecifier(
                t.identifier(reactName),
                t.identifier(reactName)
              );
              // When it's an import for a value, add `type` to the specifier, but don't do that
              // if it's something like `import type {...}` already.
              if (
                reactImportNode.importKind == null ||
                reactImportNode.importKind === "value"
              ) {
                specifier.importKind = "type";
              }
              reactImportNode.specifiers.push(specifier);
            }
          }

          // If all the import specifiers are for `type` and the import is for `value`, unify
          // import { type A, type B } → import type { A, B }
          if (
            reactImportNode.importKind == null ||
            reactImportNode.importKind === "value"
          ) {
            const areAllSpecifiersForType = reactImportNode.specifiers.every(
              (specifier) =>
                t.isImportSpecifier(specifier, { importKind: "type" })
            );
            if (areAllSpecifiersForType) {
              for (const specifier of reactImportNode.specifiers) {
                (specifier as t.ImportSpecifier).importKind = null;
              }
              reactImportNode.importKind = "type";
            }
          }
        }

        // If there are no more references to `ReactNode` as it got replaced by `ReactElement`, remove it
        if (reactImportNode !== undefined) {
          let doesReactNodeHaveUsages = false;
          let reactNodeSpecifierPath: NodePath<t.ImportSpecifier> | undefined;

          path.traverse({
            ImportSpecifier(importSpecifierPath) {
              if (
                t.isIdentifier(importSpecifierPath.node.imported, {
                  name: "ReactNode",
                })
              ) {
                reactNodeSpecifierPath = importSpecifierPath;
                importSpecifierPath.skip();
              }
            },

            Identifier(identifierPath) {
              if (
                identifierPath.node.name === "ReactNode" &&
                identifierPath.isReferencedIdentifier()
              ) {
                doesReactNodeHaveUsages = true;
                identifierPath.stop();
              }
            },
          });

          if (reactNodeSpecifierPath != null && !doesReactNodeHaveUsages) {
            reactNodeSpecifierPath.remove();
          }
        }

        // If there are no remaining imports, including default, we can remove the import declaration
        if (
          reactImportPath?.node !== undefined &&
          reactImportPath?.node.specifiers.length === 0
        ) {
          // TODO: this will remove leading comment above the import, we need to improve this to preserve the comment
          reactImportPath.remove();
        }
      },
    },
  });
}
