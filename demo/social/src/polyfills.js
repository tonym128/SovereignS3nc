import { Buffer } from 'buffer';
import process from 'process';

const g = typeof window !== 'undefined' ? window : self;

g.Buffer = Buffer;
g.process = process;
g.global = g;

// DOMParser polyfill for Web Workers (needed for AWS SDK S3 error parsing)
if (typeof g.DOMParser === 'undefined') {
    class DOMParser {
        parseFromString(str, type) {
            return {
                getElementsByTagName: (tagName) => {
                    const regex = new RegExp(`<${tagName}[^>]*>([^]*?)<\\/${tagName}>`, 'g');
                    const matches = [];
                    let match;
                    while ((match = regex.exec(str)) !== null) {
                        matches.push({
                            textContent: match[1],
                            childNodes: [{ textContent: match[1] }]
                        });
                    }
                    return matches;
                },
                querySelector: (selector) => null,
                documentElement: {
                    tagName: 'Error'
                }
            };
        }
    }
    g.DOMParser = DOMParser;
}
