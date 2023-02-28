import { createLogger } from "@box-extractor/logger";
import { JsxOpeningElement, JsxSelfClosingElement, Node, SourceFile, ts } from "ts-morph";

import { extractCallExpressionValues } from "./extractCallExpressionValues";
import { extractJsxAttributeIdentifierValue } from "./extractJsxAttributeIdentifierValue";
import { extractJsxSpreadAttributeValues } from "./extractJsxSpreadAttributeValues";
import { box, BoxNode } from "./type-factory";

const logger = createLogger("box-ex:extractor:extractAtRange");

export const extractAtRange = (source: SourceFile, line: number, column: number) => {
    const node = getTsNodeAtPosition(source, line, column);
    logger({ line, column, node: node?.getKindName() });
    if (!node) return;

    // pointing directly at the node
    if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
        return extractJsxElementProps(node);
    }

    if (Node.isCallExpression(node)) {
        // TODO box.function(node) ?
        return extractCallExpressionValues(node, "all");
    }

    // pointing at the name
    const parent = node.getParent();

    if (parent && Node.isIdentifier(node)) {
        logger({ line, column, parent: parent?.getKindName() });

        if (Node.isJsxOpeningElement(parent) || Node.isJsxSelfClosingElement(parent)) {
            return extractJsxElementProps(parent);
        }

        if (Node.isPropertyAccessExpression(parent)) {
            const grandParent = parent.getParent();
            if (Node.isJsxOpeningElement(grandParent) || Node.isJsxSelfClosingElement(grandParent)) {
                return extractJsxElementProps(grandParent);
            }
        }

        if (Node.isCallExpression(parent)) {
            // TODO box.function(node) ?
            return extractCallExpressionValues(parent, "all");
        }
    }
};

export const extractJsxElementProps = (node: JsxOpeningElement | JsxSelfClosingElement) => {
    const tagName = node.getTagNameNode().getText();
    const jsxAttributes = node.getAttributes();
    logger.scoped("jsx", { tagName, jsxAttributes: jsxAttributes.length });

    const props = new Map<string, BoxNode>();
    jsxAttributes.forEach((attrNode) => {
        if (Node.isJsxAttribute(attrNode)) {
            const nameNode = attrNode.getNameNode();
            const maybeValue =
                extractJsxAttributeIdentifierValue(attrNode.getNameNode()) ?? box.unresolvable(nameNode, []);
            props.set(nameNode.getText(), maybeValue);
            return;
        }

        if (Node.isJsxSpreadAttribute(attrNode)) {
            // increment count since there might be conditional
            // so it doesn't override the whole spread prop
            let count = 0;
            const propSizeAtThisPoint = props.size;
            const getSpreadPropName = () => `_SPREAD_${propSizeAtThisPoint}_${count++}`;

            const spreadPropName = getSpreadPropName();
            const maybeValue = extractJsxSpreadAttributeValues(attrNode, "all") ?? box.unresolvable(attrNode, []);
            props.set(spreadPropName, maybeValue);
        }
    });

    // TODO box.component(node) ?
    return { type: "component", node, tagName, props };
};

export const getTsNodeAtPosition = (sourceFile: SourceFile, line: number, column: number) => {
    const pos = ts.getPositionOfLineAndCharacter(
        sourceFile.compilerNode,
        // TS uses 0-based line and char #s
        line - 1,
        column - 1
    );

    return sourceFile.getDescendantAtPos(pos);
};
