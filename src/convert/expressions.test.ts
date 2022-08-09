import dedent from "dedent";
import { JEST_MOCK_METHODS } from "./utils/common";
import {
  transform,
  expectMigrationReporterMethodCalled,
  stateBuilder,
} from "./utils/testing";

jest.mock("../runner/migration-reporter/migration-reporter.ts");

describe("transform expressions", () => {
  it("converts basic typecast", async () => {
    const src = `(x: boolean);`;
    const expected = `(x as boolean);`;
    expect(await transform(src)).toBe(expected);
  });

  it("typecasts nested cast any", async () => {
    const src = `((x: any): T);`;
    const expected = `(x as T);`;
    expect(await transform(src)).toBe(expected);
  });

  it("typecasts nested cast object", async () => {
    const src = `((x: Object): T);`;
    const expected = dedent`
    (x as any as T);`;
    expect(await transform(src)).toBe(expected);
    expectMigrationReporterMethodCalled("usedFlowAnyObject");
  });

  it("typecasts nested cast function", async () => {
    const src = `((x: Function): T);`;
    const expected = dedent`
    (x as any as T);`;
    expect(await transform(src)).toBe(expected);
    expectMigrationReporterMethodCalled("usedFlowAnyFunction");
  });

  it("typecasts string constant", async () => {
    const src = `('foo': 'foo');`;
    const expected = `('foo' as const);`;
    expect(await transform(src)).toBe(expected);
  });

  it("typecasts number constant", async () => {
    const src = `(42: 42);`;
    const expected = `(42 as const);`;
    expect(await transform(src)).toBe(expected);
  });

  it("typecasts expression in switch disabling prettier", async () => {
    const src = dedent`
    switch (foo) {
      default:
        (foo: empty);
    }
    `;
    const expected = dedent`
    switch (foo) {
      default:
        // prettier-ignore
        (foo as never);
    }
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("typecasts expression in switch disabling prettier and preserving comment", async () => {
    const src = dedent`
    switch (foo) {
      default: {
        // Some comment
        (foo: empty);
      }
    }
    `;
    const expected = dedent`
    switch (foo) {
      default: {
        // Some comment
        // prettier-ignore
        (foo as never);
      }
    }
    `;
    expect(await transform(src)).toBe(expected);
  });

  // Arrow Function Type Parameters
  it("does not modify non-tsx arrow function parameters", async () => {
    const src = `const f = <T>(arg: T) => {arg};`;
    expect(await transform(src)).toBe(src);
  });

  it("adds extends to ambiguous type parameters that could be JSX", async () => {
    const src = dedent`
    const f = <T>(arg: T) => {arg};
    const Component = <div />;
    `;
    const expected = dedent`
    const f = <T extends unknown>(arg: T) => {arg};
    const Component = <div />;
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("adds extends to ambiguous type params when were forcing TSX parsing", async () => {
    const src = dedent`
    const test = <T>(value: T): TestType<T> => ({
      foo: 'bar'
    });
    `;
    const expected = dedent`
    const test = <T extends unknown>(value: T): TestType<T> => ({
      foo: 'bar'
    });`;
    expect(
      await transform(src, stateBuilder({ config: { forceTSX: true } }))
    ).toBe(expected);
  });

  it("does not add extends to ambiguous type params when no JSX present and not forcing TSX", async () => {
    const src = dedent`
    const test = <T>(value: T): TestType<T> => ({
      foo: 'bar'
    });
    `;
    expect(
      await transform(src, stateBuilder({ config: { forceTSX: false } }))
    ).toBe(src);
  });

  it("adds extends to multiple ambiguous type parameters that could be JSX", async () => {
    const src = dedent`
    const f = <T, T2>(arg: T, arg2: T2) => {arg, arg2};
    const Component = <div />;
    `;
    const expected = dedent`
    const f = <T extends unknown, T2 extends unknown>(arg: T, arg2: T2) => {arg, arg2};
    const Component = <div />;
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("does not add extends if the type parameter already extends and it could be JSX", async () => {
    const src = dedent`
    const f = <T: string, T2>(arg: T, arg2: T2) => {arg, arg2};
    const Component = <div />;
    `;
    const expected = dedent`
    const f = <T extends string, T2 extends unknown>(arg: T, arg2: T2) => {arg, arg2};
    const Component = <div />;
    `;
    expect(await transform(src)).toBe(expected);
  });

  describe("new expressions with exact object types", () => {
    it("should remove the exact object types from type annotations", async () => {
      const src = dedent`
      // @flow
      const a: Array<{|
        foo: 'bar'
      |}> = new Array(0);`;
      const expected = dedent`
      const a: Array<{
        foo: 'bar'
      }> = new Array(0);`;
      expect(await transform(src)).toBe(expected);
    });

    it("should remove the exact object types from type arguments", async () => {
      const src = dedent`
      // @flow
      const test = () => {
        return class extends React.Component<{||}, {|bar: string|}> {};
      };`;
      const expected = dedent`
      const test = () => {
        return class extends React.Component<Record<any, any>, {
          bar: string
        }> {};
      };`;
      expect(await transform(src)).toBe(expected);
    });

    it("should not change if there are no exact bars", async () => {
      const expected = dedent`
      const a: Array<{
        foo: 'bar'
      }> = new Array(0);`;
      expect(await transform(expected)).toBe(expected);
    });

    it("should remove the exact object types from constructed objects", async () => {
      const src = dedent`// @flow
      const a = new Array<{|
        foo: 'bar'
      |}>();`;
      const expected = dedent`
      const a = new Array<{
        foo: 'bar'
      }>();`;
      expect(await transform(src)).toBe(expected);
    });
  });

  describe("untyped reduce MemberExpression", () => {
    it("should do nothing if there is a simple primitive value", async () => {
      const rootSrc = dedent`const a = [1, 2, 3].reduce((acc, val) => acc + val, 0);`;
      const src = dedent`
      // @flow
      ${rootSrc}`;
      expect(await transform(src)).toBe(rootSrc);
    });

    it("should do nothing if there is a type annotation on reduce", async () => {
      const rootSrc = `const a = [1, 2, 3].reduce<number[]>((acc, val) => [...acc, val], []);`;
      const src = dedent`
      // @flow
      ${rootSrc}`;
      expect(await transform(src)).toBe(rootSrc);
    });

    it("should do nothing it there is a type annotation on the accumulator", async () => {
      const src = dedent`
      // @flow
      const a = [1, 2, 3].reduce((acc: number[], val) => [...acc, val], ([]: number[]));`;

      const expected = dedent`
      const a = [1, 2, 3].reduce((acc: number[], val) => [...acc, val], ([] as number[]));`;
      expect(await transform(src)).toBe(expected);
    });

    it("should add an Array<any> type if accumulator is an array", async () => {
      const src = dedent`
      // @flow
      const a = [1, 2, 3].reduce((acc: number[], val) => [...acc, val], []);`;

      const expected = dedent`
      const a = [1, 2, 3].reduce<Array<any>>((acc: number[], val) => [...acc, val], []);`;
      expect(await transform(src)).toBe(expected);
    });

    it("should add a Record<string, any> type if accumulator is an object", async () => {
      const src = dedent`
      // @flow
      const a = [1, 2, 3].reduce((acc: any, val) => ({...acc, [val]: val}), {});`;

      const expected = dedent`
      const a = [1, 2, 3].reduce<Record<string, any>>((acc: any, val) => ({...acc, [val]: val}), {});`;
      expect(await transform(src)).toBe(expected);
    });
  });

  describe("typed createSelector", () => {
    it("should strip type parameters", async () => {
      const src = dedent`
      // @flow
      const selector = createSelector<any, any, any>();
      const hook = createHook<State, Actions>();
      export default connect<State, any, any, any>();
      `;
      const expected = dedent`
      const selector = createSelector();
      const hook = createHook();
      export default connect();
      `;
      expect(await transform(src)).toBe(expected);
    });

    it("should strip type cast", async () => {
      const src = dedent`
      // @flow
      const selector: SelectorType = createSelector();
      const hook: HookFunction<State, Actions> = createHook();
      `;
      const expected = dedent`
      const selector = createSelector();
      const hook = createHook();
      `;
      expect(await transform(src)).toBe(expected);
    });
  });

  describe("styled-components", () => {
    const withFlowDisabled = stateBuilder({ config: { disableFlow: true } });

    it("Adds styled components generic argument inferring boolean props of deconstruct arg", async () => {
      const fn = "${({ isFoo }) => isFoo ? 0 : 2}";
      const src = dedent`
        export const Container = styled.div\`
          padding: ${fn}px 0;
        \`;
      `;
      const expected = dedent`
        export const Container = styled.div<{ isFoo: boolean }>\`
          padding: ${fn}px 0;
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("Adds styled components generic argument inferring boolean props of single arg", async () => {
      const fn = "${(props) => props.isFoo ? 0 : 2}";
      const src = dedent`
        export const Container = styled.div\`
          padding: ${fn}px 0;
        \`;
      `;
      const expected = dedent`
        export const Container = styled.div<{ isFoo?: boolean }>\`
          padding: ${fn}px 0;
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("Adds styled components generic argument inferring other props", async () => {
      const fn = "${(p) => p.height}";
      const fn2 = "${(p) => p.width}";
      const src = dedent`
        export const Container = styled.span\`
          heigh: ${fn}px;
          width: ${fn2}px;
        \`;
      `;
      const expected = dedent`
        export const Container = styled.span<{ height: string | number, width: string | number }>\`
          heigh: ${fn}px;
          width: ${fn2}px;
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should not add theme to styled components types", async () => {
      const fn = "${(p) => p.height * 2}";
      const fn2 = "${(p) => p.theme.width * 2}";
      const src = dedent`
        export const Container = styled.span\`
          heigh: ${fn}px;
          width: ${fn2}px;
        \`;
      `;
      const expected = dedent`
        export const Container = styled.span<{ height: number }>\`
          heigh: ${fn}px;
          width: ${fn2}px;
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should infer optional properties", async () => {
      const fn = "${({ color = 'red' }) => color}";
      const src = dedent`
        export const StyledContainer = styled.div\`
          color: ${fn};
        \`;
      `;
      const expected = dedent`
        export const StyledContainer = styled.div<{ color?: string }>\`
          color: ${fn};
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should infer whether a prop is being used as a number", async () => {
      const fn = "${(props) => props.height - 1}";
      const src = dedent`
        export const StyledContainer = styled.div\`
          height: ${fn};
        \`;
      `;
      const expected = dedent`
        export const StyledContainer = styled.div<{ height: number }>\`
          height: ${fn};
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should infer whether a prop is being used as a number in object pattern", async () => {
      const fn = "${({ margin = 1 }) => `${margin}px`}";
      const src = dedent`
        export const StyledContainer = styled.div\`
          height: ${fn};
        \`;
      `;
      const expected = dedent`
        export const StyledContainer = styled.div<{ margin?: number }>\`
          height: ${fn};
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should infer whether a prop is being used as a number + optionality when conditional", async () => {
      const fn = "${(props) => props.height ? props.height - 1 : 0}";
      const src = dedent`
        export const StyledContainer = styled.div\`
          height: ${fn};
        \`;
      `;
      const expected = dedent`
        export const StyledContainer = styled.div<{ height?: number }>\`
          height: ${fn};
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should move the types from explicit declaration from variable to type parameter", async () => {
      const fn = "${(props) => props.height ? props.height - 1 : 0}";
      const src = dedent`
        export const StyledContainer: ComponentType<{ height?: number }> = styled.div\`
          height: ${fn};
        \`;
      `;
      const expected = dedent`
        export const StyledContainer = styled.div<{
          height?: number;
        }>\`
          height: ${fn};
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should assign `any` to styled type parameter if the variable has a weird type", async () => {
      const fn = "${(props) => props.height ? props.height - 1 : 0}";
      const src = dedent`
        export const StyledContainer: Papaya = styled.div\`
          height: ${fn};
        \`;
      `;
      const expected = dedent`
        export const StyledContainer = styled.div<any>\`
          height: ${fn};
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should add type parameter to css tagged template expression if there are functions inside it", async () => {
      const fn = "${({ height }) => height ? height - 1 : 0}";
      const src = dedent`
        export const extraStyles = css\`
          height: ${fn};
        \`;
      `;
      const expected = dedent`
        export const extraStyles = css<any>\`
          height: ${fn};
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(expected);
    });

    it("should not add type parameter to css tagged template expression for simple styles", async () => {
      const src = dedent`
        export const extraStyles = css\`
          height: 100px;
        \`;
      `;
      expect(await transform(src, withFlowDisabled)).toBe(src);
    });
  });

  describe.each(JEST_MOCK_METHODS)("jest.%s paths", (mockMethod) => {
    it("should do nothing if there is no extension already", async () => {
      const src = dedent`jest.${mockMethod}('foo');`;
      expect(await transform(src)).toBe(src);
    });

    it("should remove the extension if a js or jsx one is provided", async () => {
      const src = dedent`
      jest.${mockMethod}('foo.js');
      jest.${mockMethod}('foo2.jsx');`;

      const expected = dedent`
      jest.${mockMethod}('foo');
      jest.${mockMethod}('foo2');`;
      expect(await transform(src)).toBe(expected);
    });

    it("should keep the extension if a non-js extension is provided", async () => {
      const src = dedent`
      jest.${mockMethod}('foo.ts');
      jest.${mockMethod}('foo2.tsx');`;

      expect(await transform(src)).toBe(src);
    });
  });
});
