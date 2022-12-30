import { tsquery } from "@phenomnomnominal/tsquery";
import { castAsArray, isObject, isObjectLiteral } from "pastable";
import type { CallExpression, Identifier, JsxSpreadAttribute, Node } from "ts-morph";

import { extractCallExpressionValues } from "./extractCallExpressionIdentifierValues";
import { extractJsxAttributeIdentifierValue } from "./extractJsxAttributeIdentifierValue";
import { extractJsxSpreadAttributeValues } from "./extractJsxSpreadAttributeValues";
import { getLiteralValue } from "./maybeLiteral";
import { box, castObjectLikeAsMapValue, isBoxType, isPrimitiveType, LiteralValue } from "./type-factory";
import type {
    ComponentUsedPropertiesStyle,
    ExtractedComponentProperties,
    ExtractedPropPair,
    ExtractOptions,
    ListOrAll,
    PrimitiveType,
} from "./types";
import { isNotNullish } from "./utils";

export const extract = ({ ast, components: _components, functions: _functions, used }: ExtractOptions) => {
    const components = Array.isArray(_components)
        ? Object.fromEntries(_components.map((name) => [name, { properties: "all" }]))
        : _components;
    const functions = Array.isArray(_functions)
        ? Object.fromEntries(_functions.map((name) => [name, { properties: "all" }]))
        : _functions;

    const componentPropValues: ExtractedComponentProperties[] = [];

    Object.entries(components ?? {}).forEach(([componentName, component]) => {
        const propNameList = component.properties;
        const canTakeAllProp = propNameList === "all";

        const extractedComponentPropValues = [] as ExtractedPropPair[];
        componentPropValues.push([componentName, extractedComponentPropValues]);

        // console.log(selector);
        if (!used.has(componentName)) {
            used.set(componentName, { literals: new Map(), entries: new Map(), ast: new Map() });
        }

        const componentMap = used.get(componentName)!;
        const componentSelector = `:matches(JsxOpeningElement, JsxSelfClosingElement):has(Identifier[name="${componentName}"])`;

        const namedProp = canTakeAllProp ? "" : `[name=/${propNameList.join("|")}/]`;
        const propIdentifier = `Identifier${namedProp}`;
        const propSelector = `${componentSelector} JsxAttribute > ${propIdentifier}`;
        // <ColorBox color="red.200" backgroundColor="blackAlpha.100" />
        //           ^^^^^           ^^^^^^^^^^^^^^^

        const identifierNodesFromJsxAttribute = query<Identifier>(ast, propSelector) ?? [];
        identifierNodesFromJsxAttribute.forEach((node) => {
            const propName = node.getText();
            // console.log({ propName });

            const propLiterals = componentMap.literals.get(propName) ?? new Set();
            const propEntries = componentMap.entries.get(propName) ?? (new Map() as Map<string, Set<LiteralValue>>);
            const propAst = componentMap.ast.get(propName) ?? [];

            // TODO only set if not empty
            if (!componentMap.literals.has(propName)) {
                componentMap.literals.set(propName, propLiterals);
            }

            // TODO only set if not empty
            if (!componentMap.entries.has(propName)) {
                componentMap.entries.set(propName, propEntries);
            }

            const extracted = extractJsxAttributeIdentifierValue(node);
            console.log({ propName, extracted });
            const extractedValues = castAsArray(extracted).filter(isNotNullish);
            extractedValues.forEach((extractType) => {
                if (extractType.type === "literal") {
                    propLiterals.add(extractType.value);
                    return;
                }

                if (extractType.type === "object" || extractType.type === "map") {
                    const entries =
                        extractType.type === "object"
                            ? Object.entries(extractType.value)
                            : Array.from(extractType.value.entries());
                    entries.forEach(([entryPropName, value]) => {
                        const entryPropValues = propEntries.get(entryPropName) ?? new Set();
                        if (!propEntries.has(entryPropName)) {
                            propEntries.set(entryPropName, entryPropValues);
                        }

                        entryPropValues.add(value);
                    });

                    return;
                }

                if (extractType.type === "conditional") {
                    const literal = getLiteralValue(extractType);
                    console.dir({ literal }, { depth: null });
                }
            });

            extractedComponentPropValues.push([propName, extracted] as ExtractedPropPair);
        });

        const spreadSelector = `${componentSelector} JsxSpreadAttribute`;
        // <ColorBox {...{ color: "facebook.100" }}>spread</ColorBox>
        //           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

        const spreadNodes = query<JsxSpreadAttribute>(ast, spreadSelector) ?? [];
        spreadNodes.forEach((node) => {
            const objectOrMapType = extractJsxSpreadAttributeValues(node);
            const map = castObjectLikeAsMapValue(objectOrMapType);

            return mergeSpreadEntries({
                extracted: Array.from(map.entries()),
                propNameList,
                componentMap,
                extractedComponentPropValues,
            });
        });

        // console.log(extractedComponentPropValues);

        // console.log(
        //     identifierNodesFromJsxAttribute.map((n) => [n.getParent().getText(), extractJsxAttributeIdentifierValue(n)])
        //     // .filter((v) => !v[v.length - 1])
        // );
    });

    Object.entries(functions ?? {}).forEach(([functionName, component]) => {
        const propNameList = component.properties;
        const extractedComponentPropValues = [] as ExtractedPropPair[];
        componentPropValues.push([functionName, extractedComponentPropValues]);

        if (!used.has(functionName)) {
            used.set(functionName, { literals: new Map(), entries: new Map() });
        }

        const componentMap = used.get(functionName)!;
        const sprinklesFnSelector = `JsxAttributes CallExpression:has(Identifier[name="${functionName}"])`;
        // <div className={colorSprinkles({ color: "blue.100" })}></ColorBox>
        //                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

        // console.log({ sprinklesFnSelector, functionName, propNameList });
        const maybeObjectNodes = query<CallExpression>(ast, sprinklesFnSelector) ?? [];
        maybeObjectNodes.forEach((node) => {
            const extracted = extractCallExpressionValues(node);
            if (!extracted) return;
            // console.log({ extracted });

            return mergeSpreadEntries({
                extracted: Array.from(castObjectLikeAsMapValue(extracted).entries()) as ExtractedPropPair[],
                propNameList,
                componentMap,
                extractedComponentPropValues,
            });
        });
    });

    return componentPropValues;
};

/**
 * reverse prop entries so that the last one wins
 * @example <Box sx={{ ...{ color: "red" }, color: "blue" }} />
 * // color: "blue" wins / color: "red" is ignored
 */
function mergeSpreadEntries({
    extracted,
    propNameList: maybePropNameList,
    componentMap,
    extractedComponentPropValues,
}: {
    extracted: ExtractedPropPair[];
    propNameList: ListOrAll;
    componentMap: ComponentUsedPropertiesStyle;
    extractedComponentPropValues: ExtractedPropPair[];
}) {
    const foundPropList = new Set<PrimitiveType>();
    const canTakeAllProp = maybePropNameList === "all";
    const propNameList = canTakeAllProp ? [] : maybePropNameList;

    const entries = extracted.reverse().filter(([propName]) => {
        if (!canTakeAllProp && !propNameList.includes(propName)) return false;
        if (foundPropList.has(propName)) return false;

        foundPropList.add(propName);
        return true;
    });

    console.dir({ extracted, entries }, { depth: null });
    // reverse again to keep the original order
    entries.reverse().forEach(([propName, propValue]) => {
        const propValues = componentMap.literals.get(propName) ?? new Set();

        // TODO only set if not empty
        if (!componentMap.literals.has(propName)) {
            componentMap.literals.set(propName, propValues);
        }

        console.log({ propName, propValue, propValues });
        propValues.add(propValue);
        propValue.forEach((value) => {
            const literal = getLiteralValue(value);
            if (!literal) return;

            // propValues.add(literal);
            extractedComponentPropValues.push([propName, literal]);
        });
    });

    return entries;
}

// https://gist.github.com/dsherret/826fe77613be22676778b8c4ba7390e7
export function query<T extends Node = Node>(node: Node, q: string): T[] {
    return tsquery(node.compilerNode as any, q).map((n) => (node as any)._getNodeFromCompilerNode(n) as T);
}
