import * as t from "@babel/types";
import traverse, { NodePath } from "@babel/traverse";
import {
  replaceWith,
  inheritLocAndComments,
  isInsideCreateReactClass,
  buildTSIdentifier,
  getLoc,
} from "./utils/common";
import { migrateType } from "./migrate/type";
import { migrateFunctionParameters } from "./migrate/function-parameter";
import {
  migrateTypeParameterDeclaration,
  migrateTypeParameterInstantiation,
} from "./migrate/type-parameter";
import { migrateQualifiedIdentifier } from "./migrate/qualified-identifier";
import { annotateParamsWithFlowTypeAtPos } from "./flow/annotate-params";
import { functionVisitor } from "./function-visitor";
import { TransformerInput } from "./transformer";
import { ReactTypes } from "./utils/type-mappings";
import { flowTypeAtPos } from "./flow/type-at-pos";

/**
 * Rename React imports for TypeScript
 */
const updateReactImports = (
  node: t.ImportDeclaration,
  specifier: t.ImportSpecifier
) => {
  if (
    node.source.value === "react" &&
    (specifier.importKind === "type" || node.importKind === "type")
  ) {
    // `import type {Node} from 'react'` => `import {ReactNode} from 'react'`
    if (
      specifier.type === "ImportSpecifier" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name in ReactTypes
    ) {
      specifier.imported.name =
        ReactTypes[specifier.imported.name as keyof typeof ReactTypes];
    }
    // `import {type Node} from 'react'` => `import {ReactNode} from 'react'`
    if (
      specifier.type === "ImportSpecifier" &&
      specifier.local.type === "Identifier" &&
      specifier.local.name in ReactTypes
    ) {
      specifier.local.name =
        ReactTypes[specifier.local.name as keyof typeof ReactTypes];
    }
    // `import type {ReactNode as ReactNode} from 'react'` => `import {ReactNode} from 'react'`
    if (
      specifier.type === "ImportSpecifier" &&
      specifier.local.type === "Identifier" &&
      specifier.imported.type === "Identifier" &&
      specifier.imported.name === specifier.local.name
    ) {
      // @ts-expect-error local is not optional, but setting equal doesn't work
      delete specifier.local;
    }
  }
};

const updateRelayImports = (path: NodePath<t.ImportDeclaration>) => {
  path.parentPath.traverse({
    CallExpression(cxPath) {
      // useLazyLoadQuery<Query$variables, Query$data>(...) -> useLazyLoadQuery<Query>(...)
      if (t.isIdentifier(cxPath.node.callee, { name: "useLazyLoadQuery" })) {
        const varsSpecifier = path.node.specifiers.find(
          (s) =>
            s.type === "ImportSpecifier" &&
            s.imported.type === "Identifier" &&
            /\w+\$variables$/.test(s.imported.name)
        ) as any;
        const dataSpecifier = path.node.specifiers.find(
          (s) =>
            s.type === "ImportSpecifier" &&
            s.imported.type === "Identifier" &&
            /\w+\$data$/.test(s.imported.name)
        );
        const importName = varsSpecifier?.imported.name.replace(
          "$variables",
          ""
        );
        const typeSpecifier = path.node.specifiers.find(
          (s) =>
            s.type === "ImportSpecifier" &&
            s.imported.type === "Identifier" &&
            s.imported.name === importName
        )?.local.name;

        if (!typeSpecifier) {
          if (varsSpecifier) {
            varsSpecifier.imported.name = importName;
            delete varsSpecifier.local;
          }
        } else {
          path.node.specifiers = path.node.specifiers.filter(
            (s) => s !== varsSpecifier
          );
        }
        if (varsSpecifier) {
          path.node.specifiers = path.node.specifiers.filter(
            (s) => s !== dataSpecifier
          );
        }

        // if import replacement happened
        if (importName != null && cxPath.node.typeParameters) {
          cxPath.node.typeParameters.params = [
            t.tsTypeReference(t.identifier(typeSpecifier ?? importName)),
          ];
        }
      }
    },
  });
};

export function transformDeclarations({
  reporter,
  state,
  file,
}: TransformerInput): Promise<unknown> {
  const awaitPromises: Array<Promise<unknown>> = [];

  traverse(file, {
    ImportDeclaration(path) {
      // `import typeof X from` => `import {...} from`
      if (path.node.importKind === "typeof") {
        path.node.extra ??= {};
        path.node.extra.wasImportTypeOf = true;
        path.node.importKind = "type";
      }

      // `import X from `foo.js` -> extension warning
      if (path.node.source) {
        const { value } = path.node.source;
        const isJS = value.endsWith(".js");
        const isJSX = value.endsWith(".jsx");
        if (isJS || isJSX) {
          reporter.importWithExtension(
            state.config.filePath,
            getLoc(path.node),
            value
          );
        }

        if (state.config.dropImportExtensions) {
          if (isJS) {
            path.node.source.value = value.slice(0, -3);
          } else if (isJSX) {
            path.node.source.value = value.slice(0, -4);
          }
        }
      }

      // `import {...} from`
      if (path.node.specifiers) {
        for (const specifier of path.node.specifiers) {
          // `import {typeof...} from`
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind === "typeof"
          ) {
            specifier.extra ??= {};
            specifier.extra.wasImportTypeOf = true;
            specifier.importKind = "type";
          }

          if (
            specifier.type === "ImportSpecifier" &&
            (specifier.importKind === "type" || path.node.importKind === "type")
          ) {
            updateReactImports(path.node, specifier);
          }
        }

        if (path.node.source.value.endsWith(".graphql")) {
          updateRelayImports(path);
        }

        return;
      }

      throw new Error(
        `Unrecognized import kind: ${JSON.stringify(path.node.importKind)}`
      );
    },

    ExportAllDeclaration(path) {
      delete path.node.exportKind;
    },

    TypeAlias(path) {
      replaceWith(
        path,
        t.tsTypeAliasDeclaration(
          path.node.id,
          path.node.typeParameters
            ? migrateTypeParameterDeclaration(
                reporter,
                state,
                path.node.typeParameters
              )
            : null,
          migrateType(reporter, state, path.node.right)
        ),
        state.config.filePath,
        reporter
      );
    },

    OpaqueType(path) {
      if (path.node.supertype) {
        reporter.opaqueSuperType(state.config.filePath, getLoc(path.node));
      }

      // Currently we just drop the `opaque` from an opaque type alias. We have only a few
      // opaque types so this is unfortunate, but acceptable. We can manually migrate to a
      // similar form.
      replaceWith(
        path,
        t.tsTypeAliasDeclaration(
          path.node.id,
          path.node.typeParameters
            ? migrateTypeParameterDeclaration(
                reporter,
                state,
                path.node.typeParameters
              )
            : null,
          migrateType(reporter, state, path.node.impltype)
        ),
        state.config.filePath,
        reporter
      );
    },

    DeclareVariable(path) {
      const tsDeclareVariable = t.variableDeclaration("let", [
        t.variableDeclarator(path.node.id),
      ]);
      tsDeclareVariable.declare = true;

      replaceWith(path, tsDeclareVariable, state.config.filePath, reporter);
    },

    DeclareFunction(path) {
      const { typeAnnotation } = path.node.id;
      if (
        typeAnnotation?.type === "TypeAnnotation" &&
        typeAnnotation.typeAnnotation.type === "FunctionTypeAnnotation"
      ) {
        const functionTypeAnnotation = typeAnnotation.typeAnnotation;

        const tsTypeParameters = functionTypeAnnotation.typeParameters
          ? migrateTypeParameterDeclaration(
              reporter,
              state,
              functionTypeAnnotation.typeParameters
            )
          : null;
        const tsParameters = migrateFunctionParameters(
          reporter,
          state,
          functionTypeAnnotation
        );
        const tsReturnType = migrateType(
          reporter,
          state,
          functionTypeAnnotation.returnType
        );

        const tsDeclareFunction = t.tsDeclareFunction(
          t.identifier(path.node.id.name),
          tsTypeParameters,
          tsParameters,
          t.tsTypeAnnotation(tsReturnType)
        );

        replaceWith(path, tsDeclareFunction, state.config.filePath, reporter);
      }
    },

    DeclareClass(path) {
      path.remove();
    },

    InterfaceDeclaration(path) {
      if (path.node.mixins && path.node.mixins.length > 0)
        throw new Error("Interface `mixins` are unsupported.");
      if (path.node.implements && path.node.implements.length > 0)
        throw new Error("Interface `implements` are unsupported.");

      const typeParameters = path.node.typeParameters
        ? migrateTypeParameterDeclaration(
            reporter,
            state,
            path.node.typeParameters
          )
        : null;

      const extends_ = path.node.extends
        ? path.node.extends.map((flowExtends) => {
            const tsExtends = t.tsExpressionWithTypeArguments(
              migrateQualifiedIdentifier(flowExtends.id),
              flowExtends.typeParameters
                ? migrateTypeParameterInstantiation(
                    reporter,
                    state,
                    flowExtends.typeParameters
                  )
                : null
            );
            inheritLocAndComments(flowExtends, tsExtends);
            return tsExtends;
          })
        : null;

      const body = migrateType(reporter, state, path.node.body, {
        isInterfaceBody: true,
      });
      if (!t.isTSTypeLiteral(body))
        throw new Error(`Unexpected AST node: ${JSON.stringify(body.type)}`);

      replaceWith(
        path,
        t.tsInterfaceDeclaration(
          path.node.id,
          typeParameters,
          extends_,
          t.tsInterfaceBody(body.members)
        ),
        state.config.filePath,
        reporter
      );
    },

    ArrayPattern: {
      exit(path) {
        const isInsideFunction =
          t.isFunctionDeclaration(path.parentPath) ||
          t.isArrowFunctionExpression(path.parentPath) ||
          t.isFunctionExpression(path.parentPath) ||
          t.isObjectMethod(path.parentPath) ||
          t.isClassMethod(path.parentPath) ||
          t.isClassPrivateMethod(path.parentPath);

        // this tuple is not literally len(2) but rather is an n-dimensional tuple based on the length of the supplied array
        const tupleTypes = path.node.elements.map((node) => {
          if (
            node?.type === "Identifier" &&
            t.isTypeAnnotation(node.typeAnnotation)
          ) {
            const originalType = node.typeAnnotation.typeAnnotation;
            if (!isInsideFunction) {
              reporter.invalidArrayPatternType(
                state.config.filePath,
                getLoc(node)
              );
            }
            node.typeAnnotation = null;
            return migrateType(reporter, state, originalType);
          } else {
            return t.tsAnyKeyword();
          }
        });

        if (isInsideFunction) {
          path.node.typeAnnotation = t.tsTypeAnnotation(
            t.tsTupleType(tupleTypes)
          );
        }
      },
    },

    VariableDeclarator(path) {
      if (
        path.parent.type === "VariableDeclaration" &&
        path.parentPath.parent.type !== "ForStatement" &&
        path.parentPath.parent.type !== "ForInStatement" &&
        path.parentPath.parent.type !== "ForOfStatement" &&
        path.node.id.type === "Identifier" &&
        path.node.id.typeAnnotation == null
      ) {
        // `let x = {};` → `let x: Record<string, any> = {};`
        // If assigning an empty object literal, typescript cannot correct infer the type.
        if (
          path.node.init?.type === "ObjectExpression" &&
          path.node.init.properties.length === 0
        ) {
          path.node.id.typeAnnotation = t.tsTypeAnnotation(
            t.tsTypeReference(
              t.identifier("Record"),
              t.tsTypeParameterInstantiation([
                t.tsStringKeyword(),
                t.tsAnyKeyword(),
              ])
            )
          );
        } else if (state.config.isTestFile) {
          // `let x;` → `let x: any;`
          // `let x = [];` → `let x: Array<any> = [];`
          // TypeScript can’t infer the type of an unannotated variable unlike Flow. We accept
          // lower levels of soundness in test files. We’ll manually annotate non-test files.
          if (path.node.init === null) {
            path.node.id.typeAnnotation = t.tsTypeAnnotation(t.tsAnyKeyword());
          } else if (
            path.node.init?.type === "ArrayExpression" &&
            path.node.init.elements.length === 0
          ) {
            path.node.id.typeAnnotation = t.tsTypeAnnotation(
              t.tsTypeReference(
                t.identifier("Array"),
                t.tsTypeParameterInstantiation([t.tsAnyKeyword()])
              )
            );
          }
        }

        if (
          path.node.init?.type === "ArrayExpression" &&
          path.node.init.elements.length === 0 &&
          !path.node.id.typeAnnotation
        ) {
          if (state.config.disableFlow) {
            // If flow is disabled, then we don't know, so mark it as unknown.
            (path.node.id as t.Identifier).typeAnnotation = t.tsTypeAnnotation(
              t.tsArrayType(t.tsUnknownKeyword())
            );
            reporter.disableFlowCheck(state.config.filePath, path.node.id.loc!);
          } else {
            // Ask Flow for the type of our array.
            awaitPromises.push(
              flowTypeAtPos(state, path.node.id.loc!, reporter)
                .then((flowType) => {
                  if (flowType === null) return;

                  // If Flow inferred `empty` then that means there were no calls to the
                  // function and therefore no “lower type bounds” for the parameter. This
                  // means you can do anything with the type effectively making it any. So
                  // treat it as such.
                  const tsType =
                    flowType.type === "EmptyTypeAnnotation"
                      ? t.tsAnyKeyword()
                      : migrateType(reporter, state, flowType);

                  // Typescript loses the type check on L#299 here, so we're just putting it back.
                  (path.node.id as t.Identifier).typeAnnotation =
                    t.tsTypeAnnotation(tsType);
                })
                .catch((err) => {
                  reporter.error(state.config.filePath, err);
                })
            );
          }
        }
      }

      // If we're exporting a constant Object or Array, there's a good chance it can be annotated 'as const'
      // which allows it to be used in type definitions easier.
      // If it is not an empty object, and is not already annotated.
      const isExported =
        path.parentPath.parent.type === "ExportNamedDeclaration";
      const isConstDeclaration =
        path.parent.type === "VariableDeclaration" &&
        path.parent.kind === "const";
      const isObjectDeclaration =
        path.node.init?.type === "ObjectExpression" &&
        path.node.init.properties.length > 0 &&
        !(
          path.node.init.properties.length === 1 &&
          t.isSpreadElement(path.node.init.properties[0])
        );
      const isInsideBlock = t.isBlockStatement(
        path.parentPath.parentPath?.node
      );
      const isArrayDeclaration =
        path.node.init?.type === "ArrayExpression" &&
        path.node.init.elements.length > 0 &&
        path.parent.type === "VariableDeclaration" &&
        path.parent.kind === "const";
      const hasTypeAnnotation =
        path.node.id.type === "Identifier" &&
        path.node.id.typeAnnotation !== undefined &&
        path.node.id.typeAnnotation !== null;
      if (
        isConstDeclaration &&
        ((isObjectDeclaration && !isInsideBlock) ||
          (isExported && isArrayDeclaration)) &&
        !hasTypeAnnotation
      ) {
        const asExpression = t.tsAsExpression(
          path.node.init as t.Expression,
          t.tsTypeReference(t.identifier("const"))
        );
        inheritLocAndComments(path.node.init as t.Expression, asExpression);
        path.node.init = asExpression;
      }
    },
    FunctionExpression: functionVisitor({ awaitPromises, reporter, state }),
    FunctionDeclaration: functionVisitor({ awaitPromises, reporter, state }),
    ArrowFunctionExpression: functionVisitor({
      awaitPromises,
      reporter,
      state,
    }),

    CatchClause(path) {
      // In Flow caught errors are typed as `empty`, which behaves like any
      // Old versions of TypeScript used to match this behavior, but in recent versions
      // (3.4+) you can assign the type `any` or `unknown` with any being the default in
      // `strict` mode. The codemod adds any, so you can keep the same behavior as flow
      // for migrated code, but default to unknown in the future.
      const { node } = path;

      if (t.isIdentifier(node.param)) {
        const { param } = node;
        node.param = buildTSIdentifier(
          param.name,
          false,
          t.tsTypeAnnotation(t.tsAnyKeyword())
        );
      }
    },

    ClassProperty(path) {
      // `class { +prop: boolean }` => `class { readonly prop: boolean }`
      // the typescript decls for ClassProperty don't have variance for some reason
      const nodeAsAny = path.node;
      if (nodeAsAny.variance && nodeAsAny.variance.kind === "plus") {
        nodeAsAny.variance = null;
        nodeAsAny.readonly = true;
      }
    },

    ClassMethod: functionVisitor({ awaitPromises, reporter, state }),
    ClassDeclaration(path) {
      const { node } = path;
      if (node.superClass && node.superTypeParameters) {
        node.superTypeParameters = migrateTypeParameterInstantiation(
          reporter,
          state,
          node.superTypeParameters as t.TypeParameterInstantiation
        );
      }
    },
    ObjectMethod(path) {
      // Add Flow’s inferred type for all unannotated function parameters if inside a react class
      awaitPromises.push(
        annotateParamsWithFlowTypeAtPos(
          reporter,
          state,
          path.node.params,
          path,
          isInsideCreateReactClass(path)
        )
      );
    },
  });

  return Promise.all(awaitPromises);
}
