import { createLogger } from "@box-extractor/logger";
import { isObject } from "pastable";
import type {
    ArrayLiteralExpression,
    BinaryExpression,
    BindingElement,
    ElementAccessExpression,
    ExportDeclaration,
    Identifier,
    ImportDeclaration,
    ObjectLiteralElementLike,
    ObjectLiteralExpression,
    PropertyAccessExpression,
    PropertySignature,
    SourceFile,
    TemplateExpression,
    TypeLiteralNode,
    TypeNode,
    VariableDeclaration,
} from "ts-morph";
import { Node, ts } from "ts-morph";

import { safeEvaluateNode } from "./evaluate";
// eslint-disable-next-line import/no-cycle
import { findIdentifierValueDeclaration } from "./findIdentifierValueDeclaration";
// eslint-disable-next-line import/no-cycle
import { maybeObjectLikeBox } from "./maybeObjectLikeBox";
import { box, BoxNode, ConditionalKind, isBoxNode, LiteralValue } from "./type-factory";
import type { EvaluatedObjectResult, PrimitiveType } from "./types";
import { isNotNullish, unwrapExpression } from "./utils";

const logger = createLogger("box-ex:extractor:maybe-box");
const cacheMap = new WeakMap<Node, MaybeBoxNodeReturn>();

export type MaybeBoxNodeReturn = BoxNode | undefined;
export function maybeBoxNode(node: Node, stack: Node[]): MaybeBoxNodeReturn {
    const isCached = cacheMap.has(node);
    logger({ kind: node.getKindName(), isCached });
    if (isCached) {
        logger.scoped("cached", { kind: node.getKindName() });
        return cacheMap.get(node);
    }

    const cache = (value: MaybeBoxNodeReturn) => {
        cacheMap.set(node, value);
        return value;
    };

    // <ColorBox color={"xxx"} />
    if (Node.isStringLiteral(node)) {
        return cache(box.literal(node.getLiteralValue(), node, stack));
    }

    // <ColorBox color={[xxx, yyy, zzz]} />
    if (Node.isArrayLiteralExpression(node)) {
        const boxes = node.getElements().map((element) => {
            const maybeBox = maybeBoxNode(element, stack);
            if (!maybeBox) return cache(box.unresolvable(element, stack));

            return maybeBox;
        });

        return cache(box.list(boxes as any, node, stack));
    }

    // <ColorBox color={`xxx`} />
    if (Node.isNoSubstitutionTemplateLiteral(node)) {
        return cache(box.literal(node.getLiteralValue(), node, stack));
    }

    // <ColorBox color={123} />
    if (Node.isNumericLiteral(node)) {
        return cache(box.literal(node.getLiteralValue(), node, stack));
    }

    // <ColorBox bool={true} falsy={false} />
    if (Node.isTrueLiteral(node) || Node.isFalseLiteral(node)) {
        return cache(box.literal(node.getLiteralValue(), node, stack));
    }

    // <ColorBox color={null} />
    if (Node.isNullLiteral(node)) {
        return cache(box.literal(null, node, stack));
    }

    // <ColorBox color={staticColor} />
    if (Node.isIdentifier(node)) {
        const name = node.getText();
        if (name === "undefined") return cache(box.literal(undefined, node, stack));

        return cache(maybeIdentifierValue(node, stack));
    }

    if (Node.isTemplateHead(node)) {
        return cache(box.literal(node.getLiteralText(), node, stack));
    }

    // <ColorBox color={`${xxx}yyy`} />
    if (Node.isTemplateExpression(node)) {
        const maybeString = maybeTemplateStringValue(node, stack);
        if (!maybeString) return;

        return cache(box.literal(maybeString, node, stack));
    }

    // <ColorBox color={xxx[yyy]} /> / <ColorBox color={xxx["zzz"]} />
    if (Node.isElementAccessExpression(node)) {
        return cache(getElementAccessedExpressionValue(node, stack));
    }

    // <ColorBox color={xxx.yyy} />
    if (Node.isPropertyAccessExpression(node)) {
        const evaluated = getPropertyAccessedExpressionValue(node, [], stack)!;
        return cache(evaluated);
    }

    // <ColorBox color={isDark ? darkValue : "whiteAlpha.100"} />
    if (Node.isConditionalExpression(node)) {
        const maybeLiteral = safeEvaluateNode<PrimitiveType | PrimitiveType[] | EvaluatedObjectResult>(node);
        if (isNotNullish(maybeLiteral)) return cache(box.cast(maybeLiteral, node, stack));

        // unresolvable condition will return both possible outcome
        const whenTrueExpr = unwrapExpression(node.getWhenTrue());
        const whenFalseExpr = unwrapExpression(node.getWhenFalse());

        return cache(
            maybeExpandConditionalExpression({
                whenTrueExpr,
                whenFalseExpr,
                node,
                stack,
                kind: "ternary",
                // canReturnWhenTrue: true,
            })
        );
    }

    // <ColorBox color={fn()} />
    if (Node.isCallExpression(node)) {
        const maybeLiteral = safeEvaluateNode<PrimitiveType | EvaluatedObjectResult>(node);
        if (!maybeLiteral) return;

        return cache(box.cast(maybeLiteral, node, stack));
    }

    if (Node.isBinaryExpression(node)) {
        const operatorKind = node.getOperatorToken().getKind();
        if (operatorKind === ts.SyntaxKind.PlusToken) {
            const maybeString =
                tryComputingPlusTokenBinaryExpressionToString(node, stack) ?? safeEvaluateNode<string>(node);
            if (!maybeString) return;

            return cache(box.cast(maybeString, node, stack));
        } else if (
            operatorKind === ts.SyntaxKind.BarBarToken ||
            operatorKind === ts.SyntaxKind.QuestionQuestionToken ||
            operatorKind === ts.SyntaxKind.AmpersandAmpersandToken
        ) {
            const whenTrueExpr = unwrapExpression(node.getLeft());
            const whenFalseExpr = unwrapExpression(node.getRight());

            return cache(
                maybeExpandConditionalExpression({
                    whenTrueExpr,
                    whenFalseExpr,
                    node,
                    stack,
                    kind: conditionalKindByOperatorKind[operatorKind],
                    canReturnWhenTrue: true,
                })
            );
        }
    }

    // console.log({ maybeBoxNodeEnd: true, expression: node.getText(), kind: node.getKindName() });
}

const conditionalKindByOperatorKind = {
    [ts.SyntaxKind.BarBarToken]: "or" as ConditionalKind,
    [ts.SyntaxKind.QuestionQuestionToken]: "nullish-coalescing" as ConditionalKind,
    [ts.SyntaxKind.AmpersandAmpersandToken]: "and" as ConditionalKind,
};

export const onlyStringLiteral = (boxNode: MaybeBoxNodeReturn) => {
    if (!boxNode) return;

    if (isBoxNode(boxNode) && box.isLiteral(boxNode) && typeof boxNode.value === "string") {
        return boxNode;
    }
};

const onlyNumberLiteral = (boxNode: MaybeBoxNodeReturn) => {
    if (!boxNode) return;

    if (isBoxNode(boxNode) && box.isLiteral(boxNode) && typeof boxNode.value === "number") {
        return boxNode;
    }
};

const maybeStringLiteral = (node: Node, stack: Node[]) => onlyStringLiteral(maybeBoxNode(node, stack));

export const maybePropName = (node: Node, stack: Node[]) => {
    logger.scoped("prop-name", node.getKindName());
    const boxed = maybeBoxNode(node, stack);
    const strBox = onlyStringLiteral(boxed);
    if (strBox) return strBox;

    const numberBox = onlyNumberLiteral(boxed);
    if (numberBox) return numberBox;
};

// <ColorBox color={isDark ? darkValue : "whiteAlpha.100"} />
export const maybeExpandConditionalExpression = ({
    whenTrueExpr,
    whenFalseExpr,
    node,
    stack,
    kind,
    canReturnWhenTrue,
}: {
    whenTrueExpr: Node;
    whenFalseExpr: Node;
    node: Node;
    stack: Node[];
    kind: ConditionalKind;
    canReturnWhenTrue?: boolean;
}) => {
    let whenTrueValue = maybeBoxNode(whenTrueExpr, stack);
    let whenFalseValue = maybeBoxNode(whenFalseExpr, stack);

    logger.scoped("cond", { before: true, whenTrueValue, whenFalseValue, canReturnWhenTrue });

    // <ColorBox color={isDark ? { mobile: "blue.100", desktop: "blue.300" } : "whiteAlpha.100"} />
    if (!whenTrueValue) {
        logger.scoped("cond", "whenTrue is not a box, maybe an object ?");
        const maybeObject = maybeObjectLikeBox(whenTrueExpr, stack);
        if (maybeObject && !maybeObject.isUnresolvable()) {
            logger.scoped("cond", "whenTrue is an object-like box");
            whenTrueValue = maybeObject;
        }
    }

    if (canReturnWhenTrue && kind !== "and" && whenTrueValue && !whenTrueValue.isUnresolvable()) {
        logger.scoped("cond", { earlyReturn: true, kind, whenTrueValue });
        return whenTrueValue;
    }

    // <ColorBox color={isDark ? { mobile: "blue.100", desktop: "blue.300" } : "whiteAlpha.100"} />
    if (!whenFalseValue) {
        logger.scoped("cond", "whenFalse is not a box, maybe an object ?");
        const maybeObject = maybeObjectLikeBox(whenFalseExpr, stack);
        if (maybeObject && !maybeObject.isUnresolvable()) {
            logger.scoped("cond", "whenFasle is an object-like box");
            whenFalseValue = maybeObject;
        }
    }

    logger.scoped("cond", {
        after: true,
        // whenTrueLiteral: whenTrueExpr.getText(),
        // whenFalseLiteral: whenFalseExpr.getText(),
        whenTrueValue,
        whenFalseValue,
    });

    if (!whenTrueValue && !whenFalseValue) {
        return;
    }

    if (whenTrueValue && !whenFalseValue) {
        return whenTrueValue;
    }

    if (!whenTrueValue && whenFalseValue) {
        return whenFalseValue;
    }

    const whenTrue = whenTrueValue!;
    const whenFalse = whenFalseValue!;

    if (whenTrue.isLiteral() && whenFalse.isLiteral() && whenTrue.value === whenFalse.value) {
        return whenTrue;
    }

    return box.conditional(whenTrue, whenFalse, node, stack, kind);
};

const findProperty = (node: ObjectLiteralElementLike, propName: string, _stack: Node[]) => {
    const stack = [..._stack];
    logger.scoped("find-prop", { propName, kind: node.getKindName() });

    if (Node.isPropertyAssignment(node)) {
        const name = node.getNameNode();
        // logger.scoped("find-prop", { name: name.getText(), kind: name.getKindName() });

        if (Node.isIdentifier(name) && name.getText() === propName) {
            stack.push(name);
            return node;
        }

        if (Node.isStringLiteral(name) && name.getLiteralText() === propName) {
            stack.push(name);
            return name.getLiteralText();
        }

        if (Node.isComputedPropertyName(name)) {
            const expression = unwrapExpression(name.getExpression());
            const computedPropNameBox = maybePropName(expression, stack);
            if (!computedPropNameBox) return;
            // console.log({ computedPropName, propName, expression: expression.getText() });

            if (String(computedPropNameBox.value) === propName) {
                stack.push(name, expression);
                return node;
            }
        }
    }

    if (Node.isShorthandPropertyAssignment(node)) {
        const name = node.getNameNode();

        if (Node.isIdentifier(name) && name.getText() === propName) {
            stack.push(name);
            return node;
        }
    }
};

const getObjectLiteralPropValue = (
    initializer: ObjectLiteralExpression,
    accessList: string[],
    _stack: Node[]
): MaybeBoxNodeReturn => {
    const stack = [..._stack];
    const propName = accessList.pop()!;
    const property =
        initializer.getProperty(propName) ?? initializer.getProperties().find((p) => findProperty(p, propName, stack));

    logger.scoped("get-prop", {
        propName,
        accessList,
        // shortcut: initializer.getProperty(propName),
        // finder: initializer.getProperties().find((p) => findProperty(p, propName, stack)),
        // property: property?.getText().slice(0, 100),
        propertyKind: property?.getKindName(),
        // properties: initializer.getProperties().map((p) => p.getText().slice(0, 100)),
        // initializer: initializer.getText().slice(0, 100),
        initializerKind: initializer.getKindName(),
    });

    if (!property) return;
    stack.push(property);

    if (Node.isPropertyAssignment(property)) {
        const propInit = property.getInitializer();
        if (!propInit) return;

        logger.scoped("get-prop", {
            propAssignment: true,
            // propInit: propInit.getText(),
            propInitKind: propInit.getKindName(),
        });

        if (Node.isObjectLiteralExpression(propInit)) {
            if (accessList.length > 0) {
                return getObjectLiteralPropValue(propInit, accessList, stack);
            }

            return maybeObjectLikeBox(propInit, stack);
        }

        const maybePropValue = maybeBoxNode(propInit, stack);
        if (maybePropValue) {
            return maybePropValue;
        }
    }

    if (Node.isShorthandPropertyAssignment(property)) {
        const identifier = property.getNameNode();
        logger.scoped("get-prop", { shorthand: true, accessList, propInit: identifier.getText() });

        if (accessList.length > 0) {
            return maybePropIdentifierValue(identifier, accessList, stack);
        }

        const maybePropValue = maybeBoxNode(identifier, stack);
        if (maybePropValue) {
            return maybePropValue;
        }
    }
};

const maybeTemplateStringValue = (template: TemplateExpression, stack: Node[]) => {
    const head = template.getHead();
    const tail = template.getTemplateSpans();

    const headValue = maybeStringLiteral(head, stack);
    if (!headValue) return;

    const tailValues = tail.map((t) => {
        const expression = t.getExpression();
        const propBox = maybePropName(expression, stack);
        // logger({ expression: expression.getText(), propBox });
        if (!propBox) return;

        const literal = t.getLiteral();
        return propBox.value + literal.getLiteralText();
    });

    // logger({ head: head.getText(), headValue, tailValues, tail: tail.map((t) => t.getText()) });

    if (tailValues.every(isNotNullish)) {
        return headValue.value + tailValues.join("");
    }
};

const maybeBindingElementValue = (def: BindingElement, stack: Node[], propName: string) => {
    const parent = def.getParent();

    logger.scoped("id-def", { parent: parent?.getKindName() });
    if (!parent) return;

    const grandParent = parent.getParent();
    logger.scoped("id-def", { grandParent: grandParent?.getKindName() });
    if (!grandParent) return;

    if (Node.isArrayBindingPattern(parent)) {
        const index = parent.getChildIndex();
        if (Number.isNaN(index)) return;

        if (Node.isVariableDeclaration(grandParent)) {
            const init = grandParent.getInitializer();
            logger.scoped("id-def", { grandParentInit: init?.getKindName() });
            if (!init) return;

            const initializer = unwrapExpression(init);
            if (!Node.isArrayLiteralExpression(initializer)) return;

            const element = initializer.getElements()[index + 1];
            logger.scoped("id-def", { index, propName, elementKind: element?.getKindName() });
            if (!element) return;

            const innerStack = [...stack, initializer, element];
            const maybeObject = maybeObjectLikeBox(element, innerStack);
            if (!maybeObject) return;

            if (box.isObject(maybeObject)) {
                const propValue = maybeObject.value[propName];
                logger.scoped("id-def", { propName, propValue });

                return box.cast(propValue, element, innerStack);
            }

            if (!maybeObject.isMap()) {
                return maybeObject;
            }

            const propValue = maybeObject.value.get(propName);
            if (!propValue) return;

            logger.scoped("id-def", { propName, propValue });
            return propValue;
        }
    }

    // TODO
    if (Node.isObjectBindingPattern(parent)) {
        //
    }
};

function maybePropDefinitionValue(def: Node, accessList: string[], _stack: Node[]) {
    const propName = accessList.at(-1)!;
    logger.scoped("maybe-prop-def-value", { propName, accessList, kind: def.getKindName() });

    if (Node.isVariableDeclaration(def)) {
        const init = def.getInitializer();
        logger.scoped("maybe-prop-def-value", {
            // init: init?.getText(),
            kind: init?.getKindName(),
            propName,
        });

        if (!init) {
            const type = def.getTypeNode();
            if (!type) return;

            if (Node.isTypeLiteral(type)) {
                logger.scoped("maybe-prop-def-value", { typeLiteral: true });

                if (accessList.length > 0) {
                    const stack = [..._stack];
                    stack.push(type);

                    let propName = accessList.pop()!;
                    let typeProp = type.getProperty(propName);
                    let typeLiteral = typeProp?.getTypeNode();
                    // logger.scoped("maybe-prop-def-value", {
                    //     before: true,
                    //     propName,
                    //     typeProp: typeProp?.getText(),
                    //     typeLiteral: typeLiteral?.getText(),
                    // });
                    while (typeProp && accessList.length > 0 && typeLiteral && Node.isTypeLiteral(typeLiteral)) {
                        stack.push(typeProp, typeLiteral);
                        propName = accessList.pop()!;
                        typeProp = typeLiteral.getProperty(propName);
                        typeLiteral = typeProp?.getTypeNode();
                    }

                    // logger.scoped("maybe-prop-def-value", {
                    //     after: true,
                    //     propName,
                    //     typeProp: typeProp?.getText(),
                    //     typeLiteral: typeLiteral?.getText(),
                    // });
                    if (!typeLiteral) return;

                    const typeValue = getTypeNodeValue(typeLiteral, stack);
                    logger.scoped("maybe-prop-def-value", { propName, typeValue: Boolean(typeValue) });
                    return box.cast(typeValue, typeLiteral, stack);
                }

                const propValue = getTypeLiteralNodePropValue(type, propName, _stack);
                _stack.push(type);
                return box.cast(propValue, type, _stack);
            }

            return;
        }

        const initializer = unwrapExpression(init);
        logger.scoped("maybe-prop-def-value", {
            // initializer: initializer.getText(),
            kind: initializer.getKindName(),
            propName,
        });

        if (Node.isObjectLiteralExpression(initializer)) {
            const propValue = getObjectLiteralPropValue(initializer, accessList, _stack);
            if (!propValue) return;

            _stack.push(initializer);
            return propValue;
        }

        if (Node.isArrayLiteralExpression(initializer)) {
            const index = Number(propName);
            if (Number.isNaN(index)) return;

            const element = initializer.getElements()[index];
            if (!element) return;

            _stack.push(initializer);
            const boxed = maybeBoxNode(element, _stack);
            if (boxed && isBoxNode(boxed) && box.isLiteral(boxed)) {
                return boxed;
            }
        }

        const innerStack = [..._stack, initializer];
        const maybeValue = maybeBoxNode(initializer, innerStack);
        if (maybeValue) return maybeValue;
    }

    if (Node.isBindingElement(def)) {
        const value = maybeBindingElementValue(def, _stack, propName);
        if (value) return value;
    }
}

const maybePropIdentifierValue = (
    identifier: Identifier,
    accessList: string[],
    _stack: Node[]
): BoxNode | undefined => {
    // console.trace();
    const maybeValueDeclaration = findIdentifierValueDeclaration(identifier, _stack);
    logger.scoped("maybePropIdentifierValue", {
        identifier: identifier.getText(),
        hasValueDeclaration: Boolean(maybeValueDeclaration),
    });
    if (!maybeValueDeclaration) {
        return box.unresolvable(identifier, _stack);
    }

    const declaration = unwrapExpression(maybeValueDeclaration);
    logger.scoped("maybePropIdentifierValue", { def: declaration.getKindName(), accessList });

    const maybeValue = maybePropDefinitionValue(maybeValueDeclaration, accessList, _stack);
    if (maybeValue) return maybeValue;

    return box.unresolvable(identifier, _stack);
};

// TODO pass & push in stack ?
const typeLiteralCache = new WeakMap<TypeLiteralNode, null | Map<string, LiteralValue>>();
const getTypeLiteralNodePropValue = (type: TypeLiteralNode, propName: string, stack: Node[]): LiteralValue => {
    if (typeLiteralCache.has(type)) {
        const map = typeLiteralCache.get(type);
        logger.scoped("cached", { typeLiteralNodeProp: true, kind: type.getKindName() });
        if (map === null) return;

        if (map?.has(propName)) {
            return map.get(propName);
        }
    }

    const members = type.getMembers();
    const prop = members.find((member) => Node.isPropertySignature(member) && member.getName() === propName);

    logger.scoped("type", {
        // prop: prop?.getText().slice(0, 20),
        propKind: prop?.getKindName(),
    });

    if (Node.isPropertySignature(prop) && prop.isReadonly()) {
        const propType = prop.getTypeNode();
        if (!propType) {
            typeLiteralCache.set(type, null);

            return;
        }

        // logger.lazyScoped("type", () => ({
        //     propType: propType.getText().slice(0, 20),
        //     propTypeKind: propType.getKindName(),
        //     propName,
        // }));

        const propValue = getTypeNodeValue(propType, stack);
        logger.scoped("type", { propName, hasPropValue: isNotNullish(propValue) });
        if (isNotNullish(propValue)) {
            if (!typeLiteralCache.has(type)) {
                typeLiteralCache.set(type, new Map());
            }

            const map = typeLiteralCache.get(type)!;
            map.set(propName, propValue);

            return propValue;
        }
    }

    typeLiteralCache.set(type, null);
};

export function getNameLiteral(wrapper: Node) {
    logger({ name: wrapper.getText(), kind: wrapper.getKindName() });
    if (Node.isStringLiteral(wrapper)) return wrapper.getLiteralText();
    return wrapper.getText();
}

const typeNodeCache = new WeakMap();
const getTypeNodeValue = (type: TypeNode, stack: Node[]): LiteralValue => {
    if (typeNodeCache.has(type)) {
        logger.scoped("cached", { typeNode: true, kind: type.getKindName() });
        return typeNodeCache.get(type);
    }

    if (Node.isLiteralTypeNode(type)) {
        const literal = type.getLiteral();
        if (Node.isStringLiteral(literal)) {
            const result = literal.getLiteralText();
            logger.scoped("type-value", { result });
            typeNodeCache.set(type, result);

            return result;
        }
    }

    if (Node.isTypeLiteral(type)) {
        const members = type.getMembers();
        if (!members.some((member) => !Node.isPropertySignature(member) || !member.isReadonly())) {
            const props = members as PropertySignature[];
            const entries = props
                .map((member) => {
                    const nameNode = member.getNameNode();
                    const nameText = nameNode.getText();
                    const name = getNameLiteral(nameNode);
                    logger({ nameNodeKind: nameNode.getKindName(), name });
                    if (!name) return;

                    const value = getTypeLiteralNodePropValue(type, nameText, stack);
                    return [name, value] as const;
                })
                .filter(isNotNullish);

            const result = Object.fromEntries(entries);
            // logger.lazyScoped("type-value", () => ({ obj: Object.keys(obj) }));
            typeNodeCache.set(type, result);

            return result;
        }
    }

    typeNodeCache.set(type, undefined);
};

const maybeDefinitionValue = (def: Node, stack: Node[]): BoxNode | undefined => {
    logger.scoped("maybe-def-value", { kind: def.getKindName() });

    if (Node.isShorthandPropertyAssignment(def)) {
        const propNameNode = def.getNameNode();
        return maybePropIdentifierValue(propNameNode, [propNameNode.getText()], stack);
    }

    // const staticColor =
    if (Node.isVariableDeclaration(def)) {
        const init = def.getInitializer();
        logger.scoped("maybe-def-value", {
            varDeclaration: true,
            // initializer: init?.getText(),
            kind: init?.getKindName(),
        });

        if (!init) {
            const type = def.getTypeNode();
            if (!type) return;

            logger.scoped("maybe-def-value", { noInit: true, kind: type.getKindName() });
            if (Node.isTypeLiteral(type)) {
                stack.push(type);
                const maybeTypeValue = getTypeNodeValue(type, stack);
                if (isNotNullish(maybeTypeValue)) return box.cast(maybeTypeValue, def, stack);
            }

            // skip evaluation if no initializer (only a type)
            // since ts-evaluator will throw an error
            return box.unresolvable(def, stack);
        }

        const initializer = unwrapExpression(init);
        const innerStack = [...stack, initializer];
        const maybeValue = maybeBoxNode(initializer, innerStack);
        if (maybeValue) return maybeValue;

        if (Node.isObjectLiteralExpression(initializer)) {
            logger.scoped("maybe-def-value", { objectLiteral: true });
            return maybeObjectLikeBox(initializer, innerStack);
        }

        // console.log({
        //     maybeDefinitionValue: true,
        //     def: def?.getText(),
        //     // identifier: identifier.getText(),
        //     kind: def?.getKindName(),
        //     initializer: initializer?.getText(),
        //     initializerKind: initializer?.getKindName(),
        // });
        return;
    }

    if (Node.isBindingElement(def)) {
        const init = def.getInitializer();
        if (!init) {
            const nameNode = def.getPropertyNameNode() ?? def.getNameNode();
            const propName = nameNode.getText();
            const innerStack = [...stack, nameNode];

            logger.scoped("maybe-def-value", { bindingElement: true, propName });
            const value = maybeBindingElementValue(def, innerStack, propName);
            if (value) return value;

            // skip evaluation if no initializer (only a type)
            // since ts-evaluator will throw an error
            return box.unresolvable(def, stack);
        }
    }
};

export const getExportedVarDeclarationWithName = (
    varName: string,
    sourceFile: SourceFile,
    stack: Node[] = []
): VariableDeclaration | undefined => {
    const maybeVar = sourceFile.getVariableDeclaration(varName);

    logger.scoped("getExportedVarDeclarationWithName", { varName, path: sourceFile.getFilePath(), hasVar: !!maybeVar });
    if (maybeVar) return maybeVar;

    const exportDeclaration = resolveVarDeclarationFromExportWithName(varName, sourceFile, stack);
    logger.scoped("getExportedVarDeclarationWithName", { exportDeclaration: Boolean(exportDeclaration) });
    if (!exportDeclaration) return;

    return exportDeclaration;
};

const hasNamedExportWithName = (name: string, exportDeclaration: ExportDeclaration) => {
    const namedExports = exportDeclaration.getNamedExports();

    // no namedExports means it's a full re-export like this: `export * from "xxx"`
    if (namedExports.length === 0) return true;

    for (const namedExport of namedExports) {
        const exportedName = namedExport.getNameNode().getText();
        logger.scoped("export-declaration", { searching: name, exportedName });

        if (exportedName === name) {
            return true;
        }
    }
};

/**
 * Faster than declaration.getModuleSpecifierSourceFile()
 *
 * since it does NOT require a call to `initializeTypeChecker`
 * > getModuleSpecifierSourceFile > getSymbol > getTypechecker > createTypeChecker > initializeTypeChecker
 *
 * which costs a minimum of around 90ms (and scales up with the file/project, could be hundreds of ms)
 * @see https://github.com/dsherret/ts-morph/blob/42d811ed9a5177fc678a5bfec4923a2048124fe0/packages/ts-morph/src/compiler/ast/module/ExportDeclaration.ts#L160
 */
export const getModuleSpecifierSourceFile = (declaration: ExportDeclaration | ImportDeclaration) => {
    const project = declaration.getProject();
    const moduleName = declaration.getModuleSpecifierValue();

    logger.scoped("getModuleSpecifierSourceFile", { moduleName });
    if (!moduleName) return;

    const containingFile = declaration.getSourceFile().getFilePath();
    const resolved = ts.resolveModuleName(
        moduleName,
        containingFile,
        project.getCompilerOptions(),
        project.getModuleResolutionHost()
    );
    logger.scoped("getModuleSpecifierSourceFile", resolved);
    if (!resolved.resolvedModule) return;

    const sourceFile = project.addSourceFileAtPath(resolved.resolvedModule.resolvedFileName);
    logger.scoped("getModuleSpecifierSourceFile", { found: Boolean(sourceFile) });

    return sourceFile;
};

function resolveVarDeclarationFromExportWithName(
    symbolName: string,
    sourceFile: SourceFile,
    stack: Node[] = []
): VariableDeclaration | undefined {
    for (const exportDeclaration of sourceFile.getExportDeclarations()) {
        const exportStack = [exportDeclaration] as Node[];
        logger("resolveVarDeclarationFromExportWithName", {
            symbolName,
            // exporDeclaration: exportDeclaration.getText(),
            exporDeclarationKind: exportDeclaration.getKindName(),
        });
        if (!hasNamedExportWithName(symbolName, exportDeclaration)) continue;

        const maybeFile = getModuleSpecifierSourceFile(exportDeclaration);
        if (!maybeFile) continue;

        exportStack.push(maybeFile);
        const maybeVar = getExportedVarDeclarationWithName(symbolName, maybeFile);
        if (maybeVar) {
            stack.push(...exportStack.concat(maybeVar));
            return maybeVar;
        }
    }
}

export const maybeIdentifierValue = (identifier: Identifier, _stack: Node[]) => {
    // console.trace();
    const valueDeclaration = findIdentifierValueDeclaration(identifier, _stack);
    logger.scoped("id-ref", { identifier: identifier.getText(), hasValueDeclaration: Boolean(valueDeclaration) });
    if (!valueDeclaration) {
        return box.unresolvable(identifier, _stack);
    }

    const declaration = unwrapExpression(valueDeclaration);
    logger.scoped("id-ref", { def: declaration.getKindName() });

    const stack = [..._stack];
    const maybeValue = maybeDefinitionValue(declaration, stack);
    if (maybeValue) return maybeValue;

    return box.unresolvable(identifier, stack);
};

const tryComputingPlusTokenBinaryExpressionToString = (node: BinaryExpression, stack: Node[]) => {
    const left = unwrapExpression(node.getLeft());
    const right = unwrapExpression(node.getRight());

    const leftValue = maybePropName(left, stack);
    const rightValue = maybePropName(right, stack);
    if (!leftValue || !rightValue) return;

    logger.scoped("tryComputingPlusTokenBinaryExpressionToString", {
        leftValue,
        rightValue,
        // left: [left.getKindName(), left.getText()],
        // right: [right.getKindName(), right.getText()],
    });

    if (isNotNullish(leftValue.value) && isNotNullish(rightValue.value)) {
        return box.literal(String(leftValue.value) + String(rightValue.value), node, stack);
    }
};

const elAccessedLogger = logger.extend("element-access");

const getElementAccessedExpressionValue = (expression: ElementAccessExpression, _stack: Node[]): MaybeBoxNodeReturn => {
    const elementAccessed = unwrapExpression(expression.getExpression());
    const argExpr = expression.getArgumentExpression();
    if (!argExpr) return;

    const arg = unwrapExpression(argExpr);
    const stack = [..._stack, elementAccessed, arg];
    const argLiteral = maybePropName(arg, stack);

    elAccessedLogger.lazy(() => ({
        // arg: arg.getText(),
        argKind: arg.getKindName(),
        // elementAccessed: elementAccessed.getText(),
        elementAccessedKind: elementAccessed.getKindName(),
        expression: expression.getText(),
        expressionKind: expression.getKindName(),
        argLiteral,
    }));

    // <ColorBox color={xxx["yyy"]} />
    if (Node.isIdentifier(elementAccessed) && argLiteral) {
        if (!isNotNullish(argLiteral.value)) return;

        return maybePropIdentifierValue(elementAccessed, [argLiteral.value.toString()], stack);
    }

    // <ColorBox color={xxx[yyy + "zzz"]} />
    if (Node.isBinaryExpression(arg)) {
        if (arg.getOperatorToken().getKind() !== ts.SyntaxKind.PlusToken) return;

        const propName = tryComputingPlusTokenBinaryExpressionToString(arg, stack) ?? maybePropName(arg, stack);

        if (propName && Node.isIdentifier(elementAccessed)) {
            if (!isNotNullish(propName.value)) return;

            return maybePropIdentifierValue(elementAccessed, [propName.value.toString()], stack);
        }
    }

    // <ColorBox color={xxx[`yyy`]} />
    if (Node.isTemplateExpression(arg)) {
        const propName = maybeTemplateStringValue(arg, stack);

        if (propName && Node.isIdentifier(elementAccessed)) {
            return maybePropIdentifierValue(elementAccessed, [propName], stack);
        }
    }

    // <ColorBox color={{ staticColor: "facebook.900" }["staticColor"]}></ColorBox>
    if (Node.isObjectLiteralExpression(elementAccessed) && argLiteral) {
        if (!isNotNullish(argLiteral.value)) return;

        return getObjectLiteralPropValue(elementAccessed, [argLiteral.value.toString()], stack);
    }

    // <ColorBox color={xxx[yyy.zzz]} />
    if (Node.isPropertyAccessExpression(arg)) {
        return getPropertyAccessedExpressionValue(arg, [], stack);
    }

    // tokens.colors.blue["400"]
    if (Node.isPropertyAccessExpression(elementAccessed) && argLiteral && isNotNullish(argLiteral.value)) {
        const propRefValue = getPropertyAccessedExpressionValue(elementAccessed, [], stack);
        if (!propRefValue) return box.unresolvable(elementAccessed, stack);

        const propName = argLiteral.value.toString();

        elAccessedLogger("PropertyAccessExpression", { propRefValue, propName });

        if (propRefValue.isObject()) {
            const propValue = propRefValue.value[propName];
            return box.cast(propValue, arg, stack);
        }

        if (propRefValue.isMap()) {
            const propValue = propRefValue.value.get(propName);
            return box.cast(propValue, arg, stack);
        }

        if (propRefValue.isList()) {
            const propValue = propRefValue.value[Number(propName)];
            return box.cast(propValue, arg, stack);
        }

        return box.unresolvable(elementAccessed, stack);
    }

    // <ColorBox color={xxx[yyy[zzz]]} />
    if (Node.isIdentifier(elementAccessed) && Node.isElementAccessExpression(arg)) {
        const propName = getElementAccessedExpressionValue(arg, stack);
        elAccessedLogger({ isArgElementAccessExpression: true, propName });

        if (typeof propName === "string" && isNotNullish(propName)) {
            return maybePropIdentifierValue(elementAccessed, [propName], stack);
        }
    }

    // <ColorBox color={xxx[yyy["zzz"]]} />
    if (Node.isElementAccessExpression(elementAccessed) && argLiteral && isNotNullish(argLiteral.value)) {
        const identifier = getElementAccessedExpressionValue(elementAccessed, stack);
        elAccessedLogger({ isElementAccessExpression: true, identifier, argValue: argLiteral });

        if (isObject(identifier)) {
            const argValue = argLiteral.value.toString();

            if (box.isMap(identifier)) {
                const maybeValue = identifier.value.get(argValue);
                elAccessedLogger({ isElementAccessExpression: true, maybeValue });
                return maybeValue;
            }

            if (box.isObject(identifier)) {
                const maybeLiteralValue = identifier.value[argValue];
                elAccessedLogger({ isElementAccessExpression: true, maybeLiteralValue });
                if (!maybeLiteralValue) return;

                return box.cast(maybeLiteralValue, expression, stack);
            }
        }
    }

    // <ColorBox color={xxx[[yyy][zzz]]} />
    if (Node.isArrayLiteralExpression(elementAccessed) && argLiteral) {
        return getArrayElementValueAtIndex(elementAccessed, Number(argLiteral.value), stack);
    }

    // <ColorBox color={xxx[aaa ? yyy : zzz]]} />
    if (Node.isConditionalExpression(arg)) {
        const propName = maybePropName(arg, stack);
        elAccessedLogger({ isConditionalExpression: true, propName });
        // eslint-disable-next-line sonarjs/no-collapsible-if
        if (isNotNullish(propName) && isNotNullish(propName.value)) {
            // eslint-disable-next-line unicorn/no-lonely-if
            if (Node.isIdentifier(elementAccessed)) {
                return maybePropIdentifierValue(elementAccessed, [propName.value.toString()], stack);
            }
        }

        const whenTrueExpr = unwrapExpression(arg.getWhenTrue());
        const whenFalseExpr = unwrapExpression(arg.getWhenFalse());

        const whenTrueValue = maybePropName(whenTrueExpr, stack);
        const whenFalseValue = maybePropName(whenFalseExpr, stack);

        elAccessedLogger.lazy(() => ({
            conditionalElementAccessed: true,
            whenTrueValue,
            whenFalseValue,
            // whenTrue: [whenTrueExpr.getKindName(), whenTrueExpr.getText()],
            // whenFalse: [whenFalseExpr.getKindName(), whenFalseExpr.getText()],
        }));

        if (Node.isIdentifier(elementAccessed)) {
            const whenTrueResolved =
                whenTrueValue && isNotNullish(whenTrueValue.value)
                    ? maybePropIdentifierValue(elementAccessed, [whenTrueValue.value.toString()], stack)
                    : undefined;
            const whenFalseResolved =
                whenFalseValue && isNotNullish(whenFalseValue.value)
                    ? maybePropIdentifierValue(elementAccessed, [whenFalseValue.value.toString()], stack)
                    : undefined;

            if (!whenTrueResolved && !whenFalseResolved) {
                return;
            }

            if (whenTrueResolved && !whenFalseResolved) {
                return whenTrueResolved;
            }

            if (!whenTrueResolved && whenFalseResolved) {
                return whenFalseResolved;
            }

            return box.conditional(whenTrueResolved!, whenFalseResolved!, arg, stack, "ternary");
        }
    }
};

const getArrayElementValueAtIndex = (array: ArrayLiteralExpression, index: number, stack: Node[]) => {
    const element = array.getElements()[index];
    if (!element) return;

    const value = maybeBoxNode(element, stack);
    elAccessedLogger({
        // array: array.getText(),
        arrayKind: array.getKindName(),
        // element: element.getText(),
        elementKind: element.getKindName(),
        value,
        // obj: maybeObjectLikeBox(element, stack),
    });

    if (isNotNullish(value)) {
        return value;
    }

    if (Node.isObjectLiteralExpression(element)) {
        return maybeObjectLikeBox(element, stack);
    }
};

const getPropertyAccessedExpressionValue = (
    expression: PropertyAccessExpression,
    _accessList: string[],
    stack: Node[]
): BoxNode | undefined => {
    const propName = expression.getName();
    const elementAccessed = unwrapExpression(expression.getExpression());
    const accessList = _accessList.concat(propName);

    logger.scoped("prop-access-value", {
        propName,
        accessList,
        // elementAccessed: elementAccessed.getText().slice(0, 100),
        elementAccessedKind: elementAccessed.getKindName(),
    });
    stack.push(elementAccessed);

    // someObj.key
    if (Node.isIdentifier(elementAccessed)) {
        return maybePropIdentifierValue(elementAccessed, accessList, stack);
    }

    // someObj.key.nested
    if (Node.isPropertyAccessExpression(elementAccessed)) {
        const propValue = getPropertyAccessedExpressionValue(elementAccessed, accessList, stack);
        logger.scoped("prop-access-value", { propName, propValue });
        return propValue;
    }

    // someObj["key"].nested
    if (Node.isElementAccessExpression(elementAccessed)) {
        const leftElementAccessed = getElementAccessedExpressionValue(elementAccessed, stack);
        if (!leftElementAccessed) return;

        logger.scoped("prop-access-value", { propName, leftElementAccessed });
        if (box.isObject(leftElementAccessed)) {
            const propValue = leftElementAccessed.value[propName];
            return box.cast(propValue, expression, stack);
        }

        if (box.isMap(leftElementAccessed)) {
            const propValue = leftElementAccessed.value.get(propName);
            return box.cast(propValue, expression, stack);
        }
    }
};
