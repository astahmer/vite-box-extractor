import { BoxNodesMap, ExtractOptions, getBoxLiteralValue, FunctionNodesMap, QueryBox } from "@box-extractor/core";
import { extract } from "@box-extractor/core";
import { Project, SourceFile, ts } from "ts-morph";
import { afterEach, expect, it } from "vitest";

import { endFileScope, setFileScope } from "@vanilla-extract/css/fileScope";
import { generateStyleFromExtraction } from "../src/generateStyleFromExtraction";
import { createAdapterContext } from "../src/jit-style";
import type { GenericConfig } from "../src/defineProperties";

const createProject = () => {
    return new Project({
        compilerOptions: {
            jsx: ts.JsxEmit.React,
            jsxFactory: "React.createElement",
            jsxFragmentFactory: "React.Fragment",
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            noUnusedParameters: false,
            declaration: false,
            noEmit: true,
            emitDeclaratio: false,
            // allowJs: true,
            // useVirtualFileSystem: true,
        },
        skipAddingFilesFromTsConfig: true,
        skipFileDependencyResolution: true,
        skipLoadingLibFiles: true,
    });
};

let project: Project = createProject();
let fileCount = 0;

let sourceFile: SourceFile;
afterEach(() => {
    if (!sourceFile) return;

    if (sourceFile.wasForgotten()) return;
    project.removeSourceFile(sourceFile);
});

const extractFromCode = (code: string | SourceFile, options?: Partial<ExtractOptions>) => {
    const extractMap = new Map() as BoxNodesMap;
    const fileName = `file${fileCount++}.tsx`;
    sourceFile =
        typeof code === "string" ? project.createSourceFile(fileName, code, { scriptKind: ts.ScriptKind.TSX }) : code;
    const extracted = extract({ ast: sourceFile, extractMap, ...options });
    // console.dir({ test: true, usedMap, extracted }, { depth: null });
    return extracted;
};

it("simple CallExpression extract + JIT style + replace call by generated className", () => {
    const sourceFile = project.createSourceFile(
        "example.css.ts",
        `
    const minimalSprinkles = defineProperties({
        properties: {
            color: {
                brand: "var(--brand)",
            }
        },
    });

    const tokens = {
        spacing: {
            4: "4px",
            8: "8px",
            12: "12px",
            16: "16px",
            20: "20px",
            24: "24px",
        },
        radii: {
            none: "0",
            sm: "0.125rem",
            base: "0.25rem",
            md: "0.375rem",
            lg: "0.5rem",
            xl: "0.75rem",
            "2xl": "1rem",
            "3xl": "1.5rem",
            full: "9999px",
        },
    }

    const tw = defineProperties({
        properties: {
            borderRadius: tokens.radii,
            padding: tokens.spacing,
        },
        shorthands: {
            p: ["padding"],
            rounded: ["borderRadius"],
        },
    });

    export const MinimalSprinklesDemo = () => {
        return <div className={minimalSprinkles({ color: "brand" })}>
            <div className={[minimalSprinkles({ color: "red.100", display: "flex" }), tw({ p: 24, rounded: 'lg' })].join(' ')}></div>
        </div>;
    };`,
        { scriptKind: ts.ScriptKind.TSX }
    );

    const extractDefs = extractFromCode(sourceFile, { functions: ["defineProperties"] });
    const queryList = (extractDefs.get("defineProperties") as FunctionNodesMap).queryList;
    expect(queryList).toMatchInlineSnapshot(`
      [
          {
              fromNode: "CallExpression",
              box: {
                  type: "map",
                  value: {
                      properties: [
                          {
                              type: "map",
                              value: {
                                  color: [
                                      {
                                          type: "map",
                                          value: {
                                              brand: [
                                                  {
                                                      type: "literal",
                                                      value: "var(--brand)",
                                                      kind: "string",
                                                      getNode: "StringLiteral",
                                                  },
                                              ],
                                          },
                                          getNode: "ObjectLiteralExpression",
                                      },
                                  ],
                              },
                              getNode: "ObjectLiteralExpression",
                              fromNode: "CallExpression",
                          },
                      ],
                  },
                  getNode: "CallExpression",
                  fromNode: "CallExpression",
              },
          },
          {
              fromNode: "CallExpression",
              box: {
                  type: "map",
                  value: {
                      properties: [
                          {
                              type: "map",
                              value: {
                                  borderRadius: [
                                      {
                                          type: "object",
                                          value: {
                                              none: "0",
                                              sm: "0.125rem",
                                              base: "0.25rem",
                                              md: "0.375rem",
                                              lg: "0.5rem",
                                              xl: "0.75rem",
                                              "2xl": "1rem",
                                              "3xl": "1.5rem",
                                              full: "9999px",
                                          },
                                          getNode: "PropertyAccessExpression",
                                      },
                                  ],
                                  padding: [
                                      {
                                          type: "object",
                                          value: {
                                              "4": "4px",
                                              "8": "8px",
                                              "12": "12px",
                                              "16": "16px",
                                              "20": "20px",
                                              "24": "24px",
                                          },
                                          getNode: "PropertyAccessExpression",
                                      },
                                  ],
                              },
                              getNode: "ObjectLiteralExpression",
                              fromNode: "CallExpression",
                          },
                      ],
                      shorthands: [
                          {
                              type: "map",
                              value: {
                                  p: [
                                      {
                                          type: "list",
                                          value: [
                                              {
                                                  type: "literal",
                                                  value: "padding",
                                                  kind: "string",
                                                  getNode: "StringLiteral",
                                              },
                                          ],
                                          getNode: "ArrayLiteralExpression",
                                      },
                                  ],
                                  rounded: [
                                      {
                                          type: "list",
                                          value: [
                                              {
                                                  type: "literal",
                                                  value: "borderRadius",
                                                  kind: "string",
                                                  getNode: "StringLiteral",
                                              },
                                          ],
                                          getNode: "ArrayLiteralExpression",
                                      },
                                  ],
                              },
                              getNode: "ObjectLiteralExpression",
                              fromNode: "CallExpression",
                          },
                      ],
                  },
                  getNode: "CallExpression",
                  fromNode: "CallExpression",
              },
          },
      ]
    `);
    expect(queryList.map((q) => getBoxLiteralValue(q.box))).toMatchInlineSnapshot(`
      [
          {
              properties: {
                  color: {
                      brand: "var(--brand)",
                  },
              },
          },
          {
              properties: {
                  borderRadius: {
                      none: "0",
                      sm: "0.125rem",
                      base: "0.25rem",
                      md: "0.375rem",
                      lg: "0.5rem",
                      xl: "0.75rem",
                      "2xl": "1rem",
                      "3xl": "1.5rem",
                      full: "9999px",
                  },
                  padding: {
                      "4": "4px",
                      "8": "8px",
                      "12": "12px",
                      "16": "16px",
                      "20": "20px",
                      "24": "24px",
                  },
              },
              shorthands: {
                  p: ["padding"],
                  rounded: ["borderRadius"],
              },
          },
      ]
    `);

    const configByName = new Map<string, { query: QueryBox; config: GenericConfig }>();
    queryList.forEach((query) => {
        const from = query.fromNode();
        const declaration = from.getParentIfKindOrThrow(ts.SyntaxKind.VariableDeclaration);
        const nameNode = declaration.getNameNode();
        const name = nameNode.getText();
        configByName.set(name, { query, config: getBoxLiteralValue(query.box) as GenericConfig });
    });

    const extracted = extractFromCode(sourceFile, { functions: ["minimalSprinkles", "tw"] });

    const ctx = createAdapterContext("debug");
    ctx.setAdapter();
    setFileScope("test/jit-style.test.ts");

    const minimalSprinkles = extracted.get("minimalSprinkles")! as FunctionNodesMap;
    expect(minimalSprinkles.queryList).toMatchInlineSnapshot(`
      [
          {
              fromNode: "CallExpression",
              box: {
                  type: "map",
                  value: {
                      color: [
                          {
                              type: "literal",
                              value: "brand",
                              kind: "string",
                              getNode: "StringLiteral",
                              fromNode: "CallExpression",
                          },
                      ],
                  },
                  getNode: "CallExpression",
                  fromNode: "CallExpression",
              },
          },
          {
              fromNode: "CallExpression",
              box: {
                  type: "map",
                  value: {
                      color: [
                          {
                              type: "literal",
                              value: "red.100",
                              kind: "string",
                              getNode: "StringLiteral",
                              fromNode: "CallExpression",
                          },
                      ],
                      display: [
                          {
                              type: "literal",
                              value: "flex",
                              kind: "string",
                              getNode: "StringLiteral",
                              fromNode: "CallExpression",
                          },
                      ],
                  },
                  getNode: "CallExpression",
                  fromNode: "CallExpression",
              },
          },
      ]
    `);

    const minimalStyles = generateStyleFromExtraction(
        "minimalSprinkles",
        minimalSprinkles,
        configByName.get("minimalSprinkles")!.config
    );
    expect(minimalStyles.classMap).toMatchInlineSnapshot(`
      {
          minimalSprinkles_color_brand: "minimalSprinkles_color_brand__1rxundp0",
          "minimalSprinkles_color_red.100": "minimalSprinkles_color_red.100__1rxundp1",
          minimalSprinkles_display_flex: "minimalSprinkles_display_flex__1rxundp2",
      }
    `);

    minimalStyles.toReplace.forEach((className, node) => node.replaceWithText(`"${className}"`));

    const tw = extracted.get("tw")! as FunctionNodesMap;
    expect(tw.queryList).toMatchInlineSnapshot(`
      [
          {
              fromNode: "CallExpression",
              box: {
                  type: "map",
                  value: {
                      p: [
                          {
                              type: "literal",
                              value: "24",
                              kind: "string",
                              getNode: "NumericLiteral",
                              fromNode: "CallExpression",
                          },
                      ],
                      rounded: [
                          {
                              type: "literal",
                              value: "lg",
                              kind: "string",
                              getNode: "StringLiteral",
                              fromNode: "CallExpression",
                          },
                      ],
                  },
                  getNode: "CallExpression",
                  fromNode: "CallExpression",
              },
          },
      ]
    `);

    const twStyles = generateStyleFromExtraction("tw", tw, configByName.get("tw")!.config);
    expect(twStyles.classMap).toMatchInlineSnapshot(`
      {
          tw_padding_24: "tw_padding_24__1rxundp3",
          tw_borderRadius_lg: "tw_borderRadius_lg__1rxundp4",
      }
    `);
    twStyles.toReplace.forEach((className, node) => node.replaceWithText(`"${className}"`));

    const { cssMap } = ctx.getCss();
    expect(cssMap.get("test/jit-style.test.ts")).toMatchInlineSnapshot(`
      ".minimalSprinkles_color_brand__1rxundp0 {
        color: var(--brand);
      }
      .minimalSprinkles_color_red\\.100__1rxundp1 {
        color: red.100;
      }
      .minimalSprinkles_display_flex__1rxundp2 {
        display: flex;
      }
      .tw_padding_24__1rxundp3 {
        padding: 24px;
      }
      .tw_borderRadius_lg__1rxundp4 {
        border-radius: 0.5rem;
      }"
    `);

    expect(sourceFile.getFullText()).toMatchInlineSnapshot(`
      "
          const minimalSprinkles = defineProperties({
              properties: {
                  color: {
                      brand: "var(--brand)",
                  }
              },
          });

          const tokens = {
              spacing: {
                  4: "4px",
                  8: "8px",
                  12: "12px",
                  16: "16px",
                  20: "20px",
                  24: "24px",
              },
              radii: {
                  none: "0",
                  sm: "0.125rem",
                  base: "0.25rem",
                  md: "0.375rem",
                  lg: "0.5rem",
                  xl: "0.75rem",
                  "2xl": "1rem",
                  "3xl": "1.5rem",
                  full: "9999px",
              },
          }

          const tw = defineProperties({
              properties: {
                  borderRadius: tokens.radii,
                  padding: tokens.spacing,
              },
              shorthands: {
                  p: ["padding"],
                  rounded: ["borderRadius"],
              },
          });

          export const MinimalSprinklesDemo = () => {
              return <div className={"minimalSprinkles_color_brand__1rxundp0"}>
                  <div className={["minimalSprinkles_color_red.100__1rxundp1 minimalSprinkles_display_flex__1rxundp2", "tw_padding_24__1rxundp3 tw_borderRadius_lg__1rxundp4"].join(' ')}></div>
              </div>;
          };"
    `);

    endFileScope();
    ctx.removeAdapter();
});

const codeSample = `
const tokens = {
    colors: {
        "blue.50": "#ebf8ff",
        "blue.100": "#bee3f8",
        "blue.200": "#90cdf4",
        "blue.300": "#63b3ed",
        "blue.400": "#4299e1",
        "blue.500": "#3182ce",
        "blue.600": "#2b6cb0",
        "blue.700": "#2c5282",
        "blue.800": "#2a4365",
        "blue.900": "#1A365D",
        "red.50": "#FFF5F5",
        "red.100": "#FED7D7",
        "red.200": "#FEB2B2",
        "red.300": "#FC8181",
        "red.400": "#F56565",
        "red.500": "#E53E3E",
        "red.600": "#C53030",
        "red.700": "#9B2C2C",
        "red.800": "#822727",
        "red.900": "#63171B",
        "brand.50": "#F7FAFC",
        "brand.100": "#EFF6F8",
        "brand.200": "#D7E8EE",
        "brand.300": "#BFDAE4",
        "brand.400": "#90BFD0",
        "brand.500": "#60A3BC",
        "brand.600": "#5693A9",
        "brand.700": "#3A6271",
        "brand.800": "#2B4955",
        "brand.900": "#1D3138",
    },
    radii: {
        none: "0",
        sm: "0.125rem",
        base: "0.25rem",
        md: "0.375rem",
        lg: "0.5rem",
        xl: "0.75rem",
        "2xl": "1rem",
        "3xl": "1.5rem",
        full: "9999px",
    },
};

const tw = defineProperties({
    conditions: {
        small: { selector: ".small &" },
        large: { selector: ".large &" },
        dark: { selector: ".dark &" },
        light: { selector: ".light &" },
        hover: { selector: "&:hover" },
        navItem: { selector: 'nav li > &' },
        hoverNotActive: { selector: '&:hover:not(:active)' }
    },
    properties: {
        display: true,
        color: tokens.colors,
        backgroundColor: tokens.colors,
        borderColor: tokens.colors,
        borderRadius: tokens.radii,
        padding: {
            4: "4px",
            8: "8px",
            12: "12px",
            16: "16px",
            20: "20px",
            24: "24px",
        },
        width: {
            "1/2": "50%",
        },
    },
    shorthands: {
        d: ["display"],
        w: ["width"],
        bg: ["backgroundColor"],
        p: ["padding"],
        rounded: ["borderRadius"],
    },
});

const className = tw({
    p: 24,
    rounded: "lg",
    bg: "blue.500",
    display: { dark: { hover: "table-footer-group" } },
    navItem: { hoverNotActive: { color: "brand.100" } },
    hover: {
        bg: "whitesmoke",
        borderColor: undefined,
        borderRadius: "2xl",
        color: "xxx".startsWith("xxx") ? "darkseagreen" : "red.200",
        w: "falsy".startsWith("xxx") ? "1/2" : "12px",
        padding: Math.random() > 0.5 ? "100px" : "4",
        d: { dark: { large: "flex" } },
        display: { light: "inline-flex" },
        backgroundColor: {
            dark: "blue.700",
            light: { large: "red.200", dark: "ThreeDHighlight" },
        },
    },
    dark: {
        p: 24,
        bg: "red.800",
        backgroundColor: "whitesmoke",
        hover: {
            color: "blue.600",
            d: {
                light: "flex",
                large: { small: "contents" },
            },
        },
    },
});`;

it("will generate multiple styles with nested conditions", () => {
    const sourceFile = project.createSourceFile("multiple.css.ts", codeSample);

    const extractDefs = extractFromCode(sourceFile, { functions: ["defineProperties"] });
    const queryList = (extractDefs.get("defineProperties") as FunctionNodesMap).queryList;

    const configByName = new Map<string, { query: QueryBox; config: GenericConfig }>();
    queryList.forEach((query) => {
        const from = query.fromNode();
        const declaration = from.getParentIfKindOrThrow(ts.SyntaxKind.VariableDeclaration);
        const nameNode = declaration.getNameNode();
        const name = nameNode.getText();
        configByName.set(name, { query, config: getBoxLiteralValue(query.box) as GenericConfig });
    });

    const ctx = createAdapterContext("debug");
    ctx.setAdapter();
    setFileScope("test/jit-style.test.ts");

    const extracted = extractFromCode(sourceFile, { functions: ["tw"] });
    const tw = extracted.get("tw")! as FunctionNodesMap;
    const twStyles = generateStyleFromExtraction("tw", tw, configByName.get("tw")!.config);

    expect(twStyles.classMap.size).toMatchInlineSnapshot("22");
    expect(twStyles.classMap).toMatchInlineSnapshot(`
      {
          "tw_backgroundColor_blue.500": "tw_backgroundColor_blue.500__1rxundp0",
          tw_padding_24: "tw_padding_24__1rxundp1",
          tw_borderRadius_lg: "tw_borderRadius_lg__1rxundp2",
          "tw_display_dark_hover_table-footer-group": "tw_display_dark_hover_table-footer-group__1rxundp3",
          "tw_color_navItem_hoverNotActive_brand.100": "tw_color_navItem_hoverNotActive_brand.100__1rxundp4",
          tw_backgroundColor_hover_whitesmoke: "tw_backgroundColor_hover_whitesmoke__1rxundp5",
          tw_borderRadius_hover_2xl: "tw_borderRadius_hover_2xl__1rxundp6",
          tw_color_hover_darkseagreen: "tw_color_hover_darkseagreen__1rxundp7",
          tw_width_hover_12px: "tw_width_hover_12px__1rxundp8",
          tw_padding_hover_100px: "tw_padding_hover_100px__1rxundp9",
          tw_padding_hover_4: "tw_padding_hover_4__1rxundpa",
          tw_display_hover_dark_large_flex: "tw_display_hover_dark_large_flex__1rxundpb",
          "tw_display_hover_light_inline-flex": "tw_display_hover_light_inline-flex__1rxundpc",
          "tw_backgroundColor_hover_dark_blue.700": "tw_backgroundColor_hover_dark_blue.700__1rxundpd",
          "tw_backgroundColor_hover_light_large_red.200": "tw_backgroundColor_hover_light_large_red.200__1rxundpe",
          tw_backgroundColor_hover_light_dark_ThreeDHighlight:
              "tw_backgroundColor_hover_light_dark_ThreeDHighlight__1rxundpf",
          tw_padding_dark_24: "tw_padding_dark_24__1rxundpg",
          "tw_backgroundColor_dark_red.800": "tw_backgroundColor_dark_red.800__1rxundph",
          tw_backgroundColor_dark_whitesmoke: "tw_backgroundColor_dark_whitesmoke__1rxundpi",
          "tw_color_dark_hover_blue.600": "tw_color_dark_hover_blue.600__1rxundpj",
          tw_display_dark_hover_light_flex: "tw_display_dark_hover_light_flex__1rxundpk",
          tw_display_dark_hover_large_small_contents: "tw_display_dark_hover_large_small_contents__1rxundpl",
      }
    `);

    twStyles.toReplace.forEach((className, node) => node.replaceWithText(`"${className}"`));

    expect(sourceFile.getFullText()).toMatchInlineSnapshot(`
      "
      const tokens = {
          colors: {
              "blue.50": "#ebf8ff",
              "blue.100": "#bee3f8",
              "blue.200": "#90cdf4",
              "blue.300": "#63b3ed",
              "blue.400": "#4299e1",
              "blue.500": "#3182ce",
              "blue.600": "#2b6cb0",
              "blue.700": "#2c5282",
              "blue.800": "#2a4365",
              "blue.900": "#1A365D",
              "red.50": "#FFF5F5",
              "red.100": "#FED7D7",
              "red.200": "#FEB2B2",
              "red.300": "#FC8181",
              "red.400": "#F56565",
              "red.500": "#E53E3E",
              "red.600": "#C53030",
              "red.700": "#9B2C2C",
              "red.800": "#822727",
              "red.900": "#63171B",
              "brand.50": "#F7FAFC",
              "brand.100": "#EFF6F8",
              "brand.200": "#D7E8EE",
              "brand.300": "#BFDAE4",
              "brand.400": "#90BFD0",
              "brand.500": "#60A3BC",
              "brand.600": "#5693A9",
              "brand.700": "#3A6271",
              "brand.800": "#2B4955",
              "brand.900": "#1D3138",
          },
          radii: {
              none: "0",
              sm: "0.125rem",
              base: "0.25rem",
              md: "0.375rem",
              lg: "0.5rem",
              xl: "0.75rem",
              "2xl": "1rem",
              "3xl": "1.5rem",
              full: "9999px",
          },
      };

      const tw = defineProperties({
          conditions: {
              small: { selector: ".small &" },
              large: { selector: ".large &" },
              dark: { selector: ".dark &" },
              light: { selector: ".light &" },
              hover: { selector: "&:hover" },
              navItem: { selector: 'nav li > &' },
              hoverNotActive: { selector: '&:hover:not(:active)' }
          },
          properties: {
              display: true,
              color: tokens.colors,
              backgroundColor: tokens.colors,
              borderColor: tokens.colors,
              borderRadius: tokens.radii,
              padding: {
                  4: "4px",
                  8: "8px",
                  12: "12px",
                  16: "16px",
                  20: "20px",
                  24: "24px",
              },
              width: {
                  "1/2": "50%",
              },
          },
          shorthands: {
              d: ["display"],
              w: ["width"],
              bg: ["backgroundColor"],
              p: ["padding"],
              rounded: ["borderRadius"],
          },
      });

      const className = "tw_backgroundColor_blue.500__1rxundp0 tw_padding_24__1rxundp1 tw_borderRadius_lg__1rxundp2 tw_display_dark_hover_table-footer-group__1rxundp3 tw_color_navItem_hoverNotActive_brand.100__1rxundp4 tw_backgroundColor_hover_whitesmoke__1rxundp5 tw_borderRadius_hover_2xl__1rxundp6 tw_color_hover_darkseagreen__1rxundp7 tw_width_hover_12px__1rxundp8 tw_padding_hover_100px__1rxundp9 tw_padding_hover_4__1rxundpa tw_display_hover_dark_large_flex__1rxundpb tw_display_hover_light_inline-flex__1rxundpc tw_backgroundColor_hover_dark_blue.700__1rxundpd tw_backgroundColor_hover_light_large_red.200__1rxundpe tw_backgroundColor_hover_light_dark_ThreeDHighlight__1rxundpf tw_padding_dark_24__1rxundpg tw_backgroundColor_dark_red.800__1rxundph tw_backgroundColor_dark_whitesmoke__1rxundpi tw_color_dark_hover_blue.600__1rxundpj tw_display_dark_hover_light_flex__1rxundpk tw_display_dark_hover_large_small_contents__1rxundpl";"
    `);

    expect(ctx.getCss().cssMap.get("test/jit-style.test.ts")).toMatchInlineSnapshot(`
      ".tw_backgroundColor_blue\\.500__1rxundp0 {
        background-color: #3182ce;
      }
      .tw_padding_24__1rxundp1 {
        padding: 24px;
      }
      .tw_borderRadius_lg__1rxundp2 {
        border-radius: 0.5rem;
      }
      .dark .tw_display_dark_hover_table-footer-group__1rxundp3:hover {
        display: table-footer-group;
      }
      nav li > .tw_color_navItem_hoverNotActive_brand\\.100__1rxundp4:hover:not(:active) {
        color: #EFF6F8;
      }
       .tw_backgroundColor_hover_whitesmoke__1rxundp5:hover {
        background-color: whitesmoke;
      }
       .tw_borderRadius_hover_2xl__1rxundp6:hover {
        border-radius: 1rem;
      }
       .tw_color_hover_darkseagreen__1rxundp7:hover {
        color: darkseagreen;
      }
       .tw_width_hover_12px__1rxundp8:hover {
        width: 12px;
      }
       .tw_padding_hover_100px__1rxundp9:hover {
        padding: 100px;
      }
       .tw_padding_hover_4__1rxundpa:hover {
        padding: 4px;
      }
      .dark.large .tw_display_hover_dark_large_flex__1rxundpb:hover {
        display: flex;
      }
      .light .tw_display_hover_light_inline-flex__1rxundpc:hover {
        display: inline-flex;
      }
      .dark .tw_backgroundColor_hover_dark_blue\\.700__1rxundpd:hover {
        background-color: #2c5282;
      }
      .light.large .tw_backgroundColor_hover_light_large_red\\.200__1rxundpe:hover {
        background-color: #FEB2B2;
      }
      .light.dark .tw_backgroundColor_hover_light_dark_ThreeDHighlight__1rxundpf:hover {
        background-color: ThreeDHighlight;
      }
      .dark .tw_padding_dark_24__1rxundpg {
        padding: 24px;
      }
      .dark .tw_backgroundColor_dark_red\\.800__1rxundph {
        background-color: #822727;
      }
      .dark .tw_backgroundColor_dark_whitesmoke__1rxundpi {
        background-color: whitesmoke;
      }
      .dark .tw_color_dark_hover_blue\\.600__1rxundpj:hover {
        color: #2b6cb0;
      }
      .dark.light .tw_display_dark_hover_light_flex__1rxundpk:hover {
        display: flex;
      }
      .dark.large.small .tw_display_dark_hover_large_small_contents__1rxundpl:hover {
        display: contents;
      }"
    `);

    endFileScope();
    ctx.removeAdapter();
});

it("will generate multiple styles with nested conditions - grouped", () => {
    const sourceFile = project.createSourceFile("multiple.grouped.css.ts", codeSample);

    const extractDefs = extractFromCode(sourceFile, { functions: ["defineProperties"] });
    const queryList = (extractDefs.get("defineProperties") as FunctionNodesMap).queryList;

    const configByName = new Map<string, { query: QueryBox; config: GenericConfig }>();
    queryList.forEach((query) => {
        const from = query.fromNode();
        const declaration = from.getParentIfKindOrThrow(ts.SyntaxKind.VariableDeclaration);
        const nameNode = declaration.getNameNode();
        const name = nameNode.getText();
        configByName.set(name, { query, config: getBoxLiteralValue(query.box) as GenericConfig });
    });

    const ctx = createAdapterContext("debug");
    ctx.setAdapter();
    setFileScope("test/jit-style.test.ts");

    const extracted = extractFromCode(sourceFile, { functions: ["tw"] });
    const tw = extracted.get("tw")! as FunctionNodesMap;
    const twStyles = generateStyleFromExtraction("tw", tw, configByName.get("tw")!.config);

    expect(twStyles.classMap.size).toMatchInlineSnapshot('22');
    expect(twStyles.classMap).toMatchInlineSnapshot(`
      {
          "tw_backgroundColor_blue.500": "tw_backgroundColor_blue.500__1rxundp0",
          tw_padding_24: "tw_padding_24__1rxundp1",
          tw_borderRadius_lg: "tw_borderRadius_lg__1rxundp2",
          "tw_display_dark_hover_table-footer-group": "tw_display_dark_hover_table-footer-group__1rxundp3",
          "tw_color_navItem_hoverNotActive_brand.100": "tw_color_navItem_hoverNotActive_brand.100__1rxundp4",
          tw_backgroundColor_hover_whitesmoke: "tw_backgroundColor_hover_whitesmoke__1rxundp5",
          tw_borderRadius_hover_2xl: "tw_borderRadius_hover_2xl__1rxundp6",
          tw_color_hover_darkseagreen: "tw_color_hover_darkseagreen__1rxundp7",
          tw_width_hover_12px: "tw_width_hover_12px__1rxundp8",
          tw_padding_hover_100px: "tw_padding_hover_100px__1rxundp9",
          tw_padding_hover_4: "tw_padding_hover_4__1rxundpa",
          tw_display_hover_dark_large_flex: "tw_display_hover_dark_large_flex__1rxundpb",
          "tw_display_hover_light_inline-flex": "tw_display_hover_light_inline-flex__1rxundpc",
          "tw_backgroundColor_hover_dark_blue.700": "tw_backgroundColor_hover_dark_blue.700__1rxundpd",
          "tw_backgroundColor_hover_light_large_red.200": "tw_backgroundColor_hover_light_large_red.200__1rxundpe",
          tw_backgroundColor_hover_light_dark_ThreeDHighlight:
              "tw_backgroundColor_hover_light_dark_ThreeDHighlight__1rxundpf",
          tw_padding_dark_24: "tw_padding_dark_24__1rxundpg",
          "tw_backgroundColor_dark_red.800": "tw_backgroundColor_dark_red.800__1rxundph",
          tw_backgroundColor_dark_whitesmoke: "tw_backgroundColor_dark_whitesmoke__1rxundpi",
          "tw_color_dark_hover_blue.600": "tw_color_dark_hover_blue.600__1rxundpj",
          tw_display_dark_hover_light_flex: "tw_display_dark_hover_light_flex__1rxundpk",
          tw_display_dark_hover_large_small_contents: "tw_display_dark_hover_large_small_contents__1rxundpl",
      }
    `);

    twStyles.toReplace.forEach((className, node) => node.replaceWithText(`"${className}"`));

    expect(sourceFile.getFullText()).toMatchInlineSnapshot(`
      "
      const tokens = {
          colors: {
              "blue.50": "#ebf8ff",
              "blue.100": "#bee3f8",
              "blue.200": "#90cdf4",
              "blue.300": "#63b3ed",
              "blue.400": "#4299e1",
              "blue.500": "#3182ce",
              "blue.600": "#2b6cb0",
              "blue.700": "#2c5282",
              "blue.800": "#2a4365",
              "blue.900": "#1A365D",
              "red.50": "#FFF5F5",
              "red.100": "#FED7D7",
              "red.200": "#FEB2B2",
              "red.300": "#FC8181",
              "red.400": "#F56565",
              "red.500": "#E53E3E",
              "red.600": "#C53030",
              "red.700": "#9B2C2C",
              "red.800": "#822727",
              "red.900": "#63171B",
              "brand.50": "#F7FAFC",
              "brand.100": "#EFF6F8",
              "brand.200": "#D7E8EE",
              "brand.300": "#BFDAE4",
              "brand.400": "#90BFD0",
              "brand.500": "#60A3BC",
              "brand.600": "#5693A9",
              "brand.700": "#3A6271",
              "brand.800": "#2B4955",
              "brand.900": "#1D3138",
          },
          radii: {
              none: "0",
              sm: "0.125rem",
              base: "0.25rem",
              md: "0.375rem",
              lg: "0.5rem",
              xl: "0.75rem",
              "2xl": "1rem",
              "3xl": "1.5rem",
              full: "9999px",
          },
      };

      const tw = defineProperties({
          conditions: {
              small: { selector: ".small &" },
              large: { selector: ".large &" },
              dark: { selector: ".dark &" },
              light: { selector: ".light &" },
              hover: { selector: "&:hover" },
              navItem: { selector: 'nav li > &' },
              hoverNotActive: { selector: '&:hover:not(:active)' }
          },
          properties: {
              display: true,
              color: tokens.colors,
              backgroundColor: tokens.colors,
              borderColor: tokens.colors,
              borderRadius: tokens.radii,
              padding: {
                  4: "4px",
                  8: "8px",
                  12: "12px",
                  16: "16px",
                  20: "20px",
                  24: "24px",
              },
              width: {
                  "1/2": "50%",
              },
          },
          shorthands: {
              d: ["display"],
              w: ["width"],
              bg: ["backgroundColor"],
              p: ["padding"],
              rounded: ["borderRadius"],
          },
      });

      const className = "tw_backgroundColor_blue.500__1rxundp0 tw_padding_24__1rxundp1 tw_borderRadius_lg__1rxundp2 tw_display_dark_hover_table-footer-group__1rxundp3 tw_color_navItem_hoverNotActive_brand.100__1rxundp4 tw_backgroundColor_hover_whitesmoke__1rxundp5 tw_borderRadius_hover_2xl__1rxundp6 tw_color_hover_darkseagreen__1rxundp7 tw_width_hover_12px__1rxundp8 tw_padding_hover_100px__1rxundp9 tw_padding_hover_4__1rxundpa tw_display_hover_dark_large_flex__1rxundpb tw_display_hover_light_inline-flex__1rxundpc tw_backgroundColor_hover_dark_blue.700__1rxundpd tw_backgroundColor_hover_light_large_red.200__1rxundpe tw_backgroundColor_hover_light_dark_ThreeDHighlight__1rxundpf tw_padding_dark_24__1rxundpg tw_backgroundColor_dark_red.800__1rxundph tw_backgroundColor_dark_whitesmoke__1rxundpi tw_color_dark_hover_blue.600__1rxundpj tw_display_dark_hover_light_flex__1rxundpk tw_display_dark_hover_large_small_contents__1rxundpl";"
    `);

    expect(ctx.getCss().cssMap.get("test/jit-style.test.ts")).toMatchInlineSnapshot(`
      ".tw_backgroundColor_blue\\.500__1rxundp0 {
        background-color: #3182ce;
      }
      .tw_padding_24__1rxundp1 {
        padding: 24px;
      }
      .tw_borderRadius_lg__1rxundp2 {
        border-radius: 0.5rem;
      }
      .dark .tw_display_dark_hover_table-footer-group__1rxundp3:hover {
        display: table-footer-group;
      }
      nav li > .tw_color_navItem_hoverNotActive_brand\\.100__1rxundp4:hover:not(:active) {
        color: #EFF6F8;
      }
       .tw_backgroundColor_hover_whitesmoke__1rxundp5:hover {
        background-color: whitesmoke;
      }
       .tw_borderRadius_hover_2xl__1rxundp6:hover {
        border-radius: 1rem;
      }
       .tw_color_hover_darkseagreen__1rxundp7:hover {
        color: darkseagreen;
      }
       .tw_width_hover_12px__1rxundp8:hover {
        width: 12px;
      }
       .tw_padding_hover_100px__1rxundp9:hover {
        padding: 100px;
      }
       .tw_padding_hover_4__1rxundpa:hover {
        padding: 4px;
      }
      .dark.large .tw_display_hover_dark_large_flex__1rxundpb:hover {
        display: flex;
      }
      .light .tw_display_hover_light_inline-flex__1rxundpc:hover {
        display: inline-flex;
      }
      .dark .tw_backgroundColor_hover_dark_blue\\.700__1rxundpd:hover {
        background-color: #2c5282;
      }
      .light.large .tw_backgroundColor_hover_light_large_red\\.200__1rxundpe:hover {
        background-color: #FEB2B2;
      }
      .light.dark .tw_backgroundColor_hover_light_dark_ThreeDHighlight__1rxundpf:hover {
        background-color: ThreeDHighlight;
      }
      .dark .tw_padding_dark_24__1rxundpg {
        padding: 24px;
      }
      .dark .tw_backgroundColor_dark_red\\.800__1rxundph {
        background-color: #822727;
      }
      .dark .tw_backgroundColor_dark_whitesmoke__1rxundpi {
        background-color: whitesmoke;
      }
      .dark .tw_color_dark_hover_blue\\.600__1rxundpj:hover {
        color: #2b6cb0;
      }
      .dark.light .tw_display_dark_hover_light_flex__1rxundpk:hover {
        display: flex;
      }
      .dark.large.small .tw_display_dark_hover_large_small_contents__1rxundpl:hover {
        display: contents;
      }"
    `);

    endFileScope();
    ctx.removeAdapter();
});
