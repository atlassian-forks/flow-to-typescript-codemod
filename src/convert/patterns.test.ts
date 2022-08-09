import dedent from "dedent";
import { transform } from "./utils/testing";

describe("transform patterns", () => {
  it("converts function assigned parameters", async () => {
    const src = `function f(x?: T = y){};`;
    const expected = `function f(x: T = y){};`;
    expect(await transform(src)).toBe(expected);
  });

  it("should generated correct code for negated instanceof expressions", async () => {
    const src = dedent`
      if (
        fieldState?.status === FOCUSED_FIELD_STATE &&
        e.relatedTarget != null &&
        // $FlowFixMe flow cannot resolve Window
        !(e.relatedTarget instanceof Window) &&
        !e.currentTarget.contains(e.relatedTarget)
      ) {
          dispatchFormSubmitAndBlurElements(formRef);
      }
    `;
    const expected = dedent`
      if (
        fieldState?.status === FOCUSED_FIELD_STATE &&
        e.relatedTarget != null &&
        !(e.relatedTarget instanceof Window) &&
        !e.currentTarget.contains(e.relatedTarget)
      ) {
          dispatchFormSubmitAndBlurElements(formRef);
      }
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("Converts returned arrays in function bodies to as const", async () => {
    const src = `function foo() {return [1,2];}`;
    const expected = `function foo() {return [1,2] as const;}`;
    expect(await transform(src)).toBe(expected);
  });

  it("Converts returned arrays in function bodies to as const", async () => {
    const src = `const foo = () => {return [1,2];}`;
    const expected = `const foo = () => {return [1,2] as const;}`;
    expect(await transform(src)).toBe(expected);
  });

  it("Does not add as const if returned arrays in function bodies are empty", async () => {
    const src = `function foo() {return [];}`;
    const expected = `function foo() {return [];}`;
    expect(await transform(src)).toBe(expected);
  });

  it("Does not add as const if function has explicit return type", async () => {
    const src = `const foo = (): [number, number] => {return [1,2];}`;
    const expected = `const foo = (): [number, number] => {return [1,2];}`;
    expect(await transform(src)).toBe(expected);
  });

  it("Does not add as const if function has explicit type", async () => {
    const src = `const foo: () => [number, number] = () => {return [1,2];}`;
    const expected = `const foo: () => [number, number] = () => {return [1,2];}`;
    expect(await transform(src)).toBe(expected);
  });

  it("Does add explicit type to untyped useState/useRef with no arg", async () => {
    const src = dedent`
      const [foo, setFoo] = useState()
      const [bar, setBar] = useRef()
    `;
    const expected = dedent`
      const [foo, setFoo] = useState<unknown>()
      const [bar, setBar] = useRef<unknown>()
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("Does add explicit type to untyped useState/useRef with empty array arg", async () => {
    const src = dedent`
      const [foo, setFoo] = useState([])
      const [bar, setBar] = useRef([])
    `;
    const expected = dedent`
      const [foo, setFoo] = useState<unknown>([])
      const [bar, setBar] = useRef<unknown>([])
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("Does add explicit type to untyped useState/useRef with null arg", async () => {
    const src = dedent`
      const [foo, setFoo] = useState(null)
      const [bar, setBar] = useRef(null)
    `;
    const expected = dedent`
      const [foo, setFoo] = useState<unknown>(null)
      const [bar, setBar] = useRef<unknown>(null)
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("Does add explicit type to untyped useState/useRef with undefined arg", async () => {
    const src = dedent`
      const [foo, setFoo] = useState(undefined)
      const [bar, setBar] = useRef(undefined)
    `;
    const expected = dedent`
      const [foo, setFoo] = useState<unknown>(undefined)
      const [bar, setBar] = useRef<unknown>(undefined)
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("Does not change types of typed useState/useRef", async () => {
    const src = dedent`
      const [foo, setFoo] = useState<Foo>(null)
      const [bar, setBar] = useRef<Bar>(null)
    `;
    const expected = dedent`
      const [foo, setFoo] = useState<Foo>(null)
      const [bar, setBar] = useRef<Bar>(null)
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("should convert values being used as types to typeof", async () => {
    const src = dedent`
      import typeof { FLAG_TYPE_WARNING } from './constants';

      export type Work = FLAG_TYPE_WARNING;
    `;
    const expected = dedent`
      import type {FLAG_TYPE_WARNING} from './constants';

      export type Work = typeof FLAG_TYPE_WARNING;
    `;
    expect(await transform(src)).toBe(expected);
  });

  it("should not convert to typeof if it cannot determine the origin for the type", async () => {
    const src = "export type Work = FLAG_TYPE_WARNING;";
    expect(await transform(src)).toBe(src);
  });

  it("should not convert to typeof if the value is already an actual type", async () => {
    const src = dedent`
      import type { FLAG_TYPE_WARNING } from './constants';

      export type Work = FLAG_TYPE_WARNING;
    `;
    expect(await transform(src)).toBe(src);
  });

  it("should convert to typeof when using the typeof modifier for an import specifier", async () => {
    const src = dedent`
      import { A, typeof FLAG_TYPE_WARNING } from './constants';

      export type Work = FLAG_TYPE_WARNING;
    `;
    const expected = dedent`
      import { A, type FLAG_TYPE_WARNING } from './constants';

      export type Work = typeof FLAG_TYPE_WARNING;
    `;
    expect(await transform(src)).toBe(expected);
  });
});
