import * as t from "@babel/types";
import traverse from "@babel/traverse";
import { TransformerInput } from "./transformer";
import { inheritLocAndComments, isInsideFunction } from "./utils/common";

export const LAZY_REGEX = /Lazy\((.+)\.js\)/g;

export const needsSnapshotUpdate = (currentContents: string): boolean =>
  LAZY_REGEX.test(currentContents);

export const updateSnapshotContents = (currentContents: string): string =>
  currentContents.replace(
    LAZY_REGEX,
    (_, innerPath) => `Lazy(${innerPath}.tsx)`
  );

export function transformPatterns({ file, state }: TransformerInput) {
  traverse(file, {
    AssignmentPattern(path) {
      // `function f(x?: T = y)` → `function f(x: T = y)`
      if (
        path.node.right &&
        path.node.left.type === "Identifier" &&
        path.node.left.optional
      ) {
        path.node.left.optional = false;
      }
    },

    CallExpression(path) {
      /**
       * Update inline snapshots to change `Lazy(*.js)` to `Lazy(*.tsx)`.
       */
      if (
        state.config.isTestFile &&
        t.isMemberExpression(path.node.callee) &&
        t.isIdentifier(path.node.callee.property) &&
        path.node.callee.property.name === "toMatchInlineSnapshot" &&
        path.node.arguments.length === 1
      ) {
        const [argument] = path.node.arguments;
        if (t.isTemplateLiteral(argument) && argument.quasis.length === 1) {
          const { raw: rawValue } = argument.quasis[0].value;
          if (needsSnapshotUpdate(rawValue)) {
            argument.quasis[0].value.raw = updateSnapshotContents(rawValue);
          }
        }
      }

      if (
        t.isIdentifier(path.node.callee) &&
        ["useState", "useRef"].includes(path.node.callee.name) &&
        path.node.typeArguments == null
      ) {
        if (
          path.node.arguments.length === 0 ||
          t.isNullLiteral(path.node.arguments[0]) ||
          (t.isIdentifier(path.node.arguments[0]) &&
            path.node.arguments[0].name === "undefined") ||
          (t.isArrayExpression(path.node.arguments[0]) &&
            !path.node.arguments[0].elements.length)
        ) {
          path.node.typeParameters = t.tsTypeParameterInstantiation([
            t.tsUnknownKeyword(),
          ]);
        }
      }
    },

    /**
     * Negated instanceof.
     */
    UnaryExpression(path) {
      if (
        path.node.operator === "!" &&
        t.isBinaryExpression(path.node.argument) &&
        path.node.argument.operator === "instanceof"
      ) {
        path.node.argument = t.parenthesizedExpression(path.node.argument);
      }
    },

    ReturnStatement(path) {
      // add "as const" if the return type of a fuction is an array expression
      const isInsideFn = isInsideFunction(path.parentPath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isNotTypedFn =
        isInsideFn &&
        (path.parentPath.parentPath?.node as any).returnType == null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isNotTypedDecl =
        isInsideFn &&
        (path.parentPath.parentPath?.parentPath?.node as any).id
          ?.typeAnnotation == null;

      if (
        isInsideFn &&
        isNotTypedFn &&
        isNotTypedDecl &&
        t.isArrayExpression(path.node.argument) &&
        path.node.argument?.elements.length > 0
      ) {
        const asExpression = t.tsAsExpression(
          path.node.argument as t.Expression,
          t.tsTypeReference(t.identifier("const"))
        );
        inheritLocAndComments(path.node.argument as t.Expression, asExpression);
        path.node.argument = asExpression;
      }
    },

    TSTypeReference(path) {
      if (!t.isIdentifier(path.node.typeName)) {
        return;
      }

      // Look into the scope and find where this name has been declared. If it's an import declaration,
      // check for metadata about it being a conversion from `import typeof`.
      const scope = path.scope.getBinding(path.node.typeName.name);
      const tsImportDeclaration = scope?.path.findParent((parent) =>
        t.isImportDeclaration(parent.node)
      );
      const wasImportTypeOf =
        (scope?.path.node.extra?.wasImportTypeOf ||
          tsImportDeclaration?.node.extra?.wasImportTypeOf) ??
        false;

      // Convert the value `V` to `typeof V` when the name reference a value being used a type.
      if (wasImportTypeOf) {
        const newNode = t.tsTypeQuery(path.node.typeName);
        inheritLocAndComments(path.node, newNode);
        path.replaceWith(newNode);
      }
    },
  });
}
