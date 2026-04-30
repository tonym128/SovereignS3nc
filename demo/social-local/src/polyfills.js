import { Buffer } from 'buffer';
import process from 'process';

const g = typeof window !== 'undefined' ? window : self;

g.Buffer = Buffer;
g.process = process;
g.global = g;

// Node polyfill for Web Workers (needed for some AWS SDK internals)
if (typeof g.Node === 'undefined') {
    g.Node = {
        ELEMENT_NODE: 1,
        ATTRIBUTE_NODE: 2,
        TEXT_NODE: 3,
        CDATA_SECTION_NODE: 4,
        ENTITY_REFERENCE_NODE: 5,
        ENTITY_NODE: 6,
        PROCESSING_INSTRUCTION_NODE: 7,
        COMMENT_NODE: 8,
        DOCUMENT_NODE: 9,
        DOCUMENT_TYPE_NODE: 10,
        DOCUMENT_FRAGMENT_NODE: 11,
        NOTATION_NODE: 12
    };
}

// Improved DOMParser polyfill for Web Workers (needed for AWS SDK S3 error parsing)
if (typeof g.DOMParser === 'undefined') {
    class DOMParser {
        parseFromString(str, type) {
            const createNode = (tagName, content) => {
                const node = {
                    tagName,
                    nodeName: tagName,
                    textContent: content,
                    nodeValue: content,
                    nodeType: 1,
                    attributes: [],
                    childNodes: content ? [{ 
                        nodeValue: content, 
                        textContent: content, 
                        nodeType: 3, 
                        "#text": content // Support some simple XML-to-JSON mappers
                    }] : [],
                    getElementsByTagName: (name) => {
                        const regex = new RegExp(`<${name}[^>]*>([^]*?)<\\/${name}>`, 'g');
                        const results = [];
                        let match;
                        while ((match = regex.exec(content)) !== null) {
                            results.push(createNode(name, match[1]));
                        }
                        return results;
                    },
                    querySelector: (selector) => null
                };
                return node;
            };
            
            const rootNode = createNode('root', str);
            return {
                ...rootNode,
                documentElement: rootNode,
                body: rootNode
            };
        }
    }
    g.DOMParser = DOMParser;
}
