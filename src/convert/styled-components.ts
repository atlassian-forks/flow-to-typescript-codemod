type StyledComponentsPattern = {
  pattern: RegExp | string | ((key: string) => boolean);
  type: string;
};

const stringOrNumberSet = new Set([
  "width",
  "height",
  "fontSize",
  "lineHeight",
  "paddingTop",
  "paddingBottom",
  "paddingLeft",
  "paddingRight",
  "marginTop",
  "marginBottom",
  "marginLeft",
  "marginRight",
  "offsetTop",
  "borderRadius",
  "borderLeft",
  "borderRight",
]);

const stringSet = new Set([
  "color",
  "colour",
  "backgroundColor",
  "display",
  "url",
  "primaryColor",
  "src",
]);

const booleanSet = new Set([
  "hide",
  "loading",
  "highlighted",
  "none",
  "dueInWeek",
  "inactive",
  "jiggle",
  "noIndent",
  "indent",
  "expandableSubtasks",
  "withSubtasks",
  "pastDue",
  "editMode",
  "withCreateProject",
  "withAvatar",
  "sticky",
  "merge",
  "visible",
  "stickyFooter",
  "stickyHeader",
  "scrollHidden",
]);

const numberSet = new Set([
  "zIndex",
  "opacity",
  "gap",
  "numChildren",
  "elementGrow",
]);

const transformationTable: StyledComponentsPattern[] = [
  {
    pattern: /^(is|has|should|show|force|disallow|can|hide|are)[A-Z]/,
    type: "boolean",
  },
  {
    pattern: (key) =>
      stringOrNumberSet.has(key) ||
      key.endsWith("Width") ||
      key.endsWith("Height") ||
      key.endsWith("Size"),
    type: "string | number",
  },
  {
    pattern: (key) =>
      stringSet.has(key) || key.endsWith("Color") || key.endsWith("Url"),
    type: "string",
  },
  {
    pattern: (key) => booleanSet.has(key) || key.endsWith("Enabled"),
    type: "boolean",
  },
  {
    pattern: (key) =>
      numberSet.has(key) || key.endsWith("Count") || key.endsWith("Offset"),
    type: "number",
  },
  {
    pattern: /^(extraStyles|styling|customStyles)$/,
    type: "Record<string, any>",
  },
];

const isMatch = (
  pattern: RegExp | string | ((k: string) => boolean),
  key: string
) => {
  if (pattern instanceof RegExp) {
    return pattern.test(key);
  }

  if (typeof pattern === "string") {
    return pattern === key;
  }

  return pattern(key);
};

export const getType = (key: string): string =>
  transformationTable.find(({ pattern }) => isMatch(pattern, key))?.type ??
  "any";
