import { NodePath } from "@babel/traverse";
import * as t from "@babel/types";

export type NodeWithComments = t.Node & {
  comments: Array<t.CommentLine | t.CommentBlock> | undefined;
};

/**
 * Set of rules that have been completely disabled and can have their
 * suppressions removed.
 */
const RULES_TO_REMOVE = new Set([
  "flowtype/define-flow-type",
  "flowtype/no-types-missing-file-annotation",
  "flowtype/require-valid-file-annotation",
  "flowtype/use-flow-type",
  "graphql/template-strings",
  "import/named",
  "jira/react-sort-props",
  "jira/react/handler-naming",
  "no-redeclare",
  "no-shadow",
  "no-undef",
  "no-unused-vars",
  "no-use-before-define",
  "react/no-unused-prop-types",
  "react/prop-types",
]);

const ESLINT_DIRECTIVE_REGEX =
  /^\s+(eslint-disable(-next-line|-line)?|eslint-enable)\s/;
const ESLINT_DISABLE_NEXT_LINE_REGEX = /^\s+eslint-disable-next-line/;
const ESLINT_DISABLE_LINE_REGEX = /^\s+eslint-disable-line/;
const ESLINT_ENABLE_REGEX = /^\s+eslint-enable\s/;
const ESLINT_DASH_DASH_COMMENT = /--(.+)$/;

const getDirectiveType = (
  commentValue: string
):
  | "eslint-disable"
  | "eslint-disable-line"
  | "eslint-disable-next-line"
  | "eslint-enable" => {
  if (ESLINT_ENABLE_REGEX.test(commentValue)) {
    return "eslint-enable";
  }

  if (ESLINT_DISABLE_NEXT_LINE_REGEX.test(commentValue)) {
    return "eslint-disable-next-line";
  }

  if (ESLINT_DISABLE_LINE_REGEX.test(commentValue)) {
    return "eslint-disable-line";
  }

  return "eslint-disable";
};

const updateWithNewDisableDirective = (comment: t.Comment, rules: string[]) => {
  const directive = getDirectiveType(comment.value);
  // Preserve dash-dash comments, such as `/* eslint-disable papaya -- some comment */`
  const dashDashComment = comment.value.match(ESLINT_DASH_DASH_COMMENT);
  const conditionalComment =
    dashDashComment === null ? "" : ` ${dashDashComment[0]}`;
  // Comment blocks without dash-dash comments need an extra trailing space
  const trailingSpace =
    comment.type === "CommentBlock" && dashDashComment === null ? " " : "";

  // Update the comment with the preserved rules
  const newCommentValue = ` ${directive} ${rules.join(
    ", "
  )}${conditionalComment}${trailingSpace}`;
  comment.value = newCommentValue;
};

/**
 * Updates a line comment for an ESLint disable directive.
 * Returning `false` means the node will be fully removed.
 */
const updateDisableNextLineComment = (comment: t.Comment) => {
  const disabledRules = comment.value
    .replace(ESLINT_DIRECTIVE_REGEX, "")
    .replace(ESLINT_DASH_DASH_COMMENT, "")
    .split(",")
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "");

  // No individual rules disabled. Keep the comment as it applies to the file
  if (disabledRules.length === 0) {
    return true;
  }

  const rulesToPreserve = disabledRules.filter(
    (rule) => !RULES_TO_REMOVE.has(rule)
  );
  // No rules to preserve. Just remove the comment line node
  if (rulesToPreserve.length === 0) {
    return false;
  }

  updateWithNewDisableDirective(comment, rulesToPreserve);
  return true;
};

/**
 * Updates comments by removing stale linter suppression directives.
 * Uses `comments` instead of `leadingComments`, `innerComments` and `trailingComments`
 * as the source code is generated via Recast instead of Babel.
 */
export const updateComments = (path: NodePath<NodeWithComments>) => {
  const { comments } = path.node as NodeWithComments;

  if (comments != null) {
    path.node.comments = comments.filter((comment) =>
      ESLINT_DIRECTIVE_REGEX.test(comment.value)
        ? updateDisableNextLineComment(comment)
        : true
    );
  }
};
